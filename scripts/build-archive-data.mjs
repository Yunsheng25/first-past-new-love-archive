import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { parseCanvasArchive } from "./web-data-utils.mjs";

const canvasPathDefault = "D:/黑曜石/canvas白板/《初恋旧爱新欢》视频制作.canvas";
const obsidianRootDefault = "D:/黑曜石";

function normalizeVaultRef(ref) {
  const normalized = String(ref).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe archive image reference: ${ref}`);
  }
  return normalized.toLowerCase();
}

function refBasename(ref) {
  return path.posix.basename(normalizeVaultRef(ref));
}

function walkImages(root, wantedPaths, wantedBasenames, found = {
  byRelativePath: new Map(),
  byBasename: new Map(),
}, vaultRoot = root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkImages(fullPath, wantedPaths, wantedBasenames, found, vaultRoot);
      continue;
    }
    const relativePath = normalizeVaultRef(path.relative(vaultRoot, fullPath));
    const basename = refBasename(relativePath);
    if (wantedPaths.has(relativePath)) found.byRelativePath.set(relativePath, fullPath);
    if (wantedBasenames.has(basename)) {
      const candidates = found.byBasename.get(basename) || [];
      candidates.push({ fullPath, relativePath });
      found.byBasename.set(basename, candidates);
    }
  }
  return found;
}

export function resolveImageSources(refs, obsidianRoot = obsidianRootDefault) {
  const uniqueRefs = [...new Set(refs)];
  const wantedPaths = new Set(uniqueRefs.map(normalizeVaultRef).filter((ref) => ref.includes("/")));
  const wantedBasenames = new Set(uniqueRefs.map(refBasename));
  const found = walkImages(obsidianRoot, wantedPaths, wantedBasenames);
  const sources = new Map();
  const missing = [];
  const ambiguous = [];

  for (const ref of uniqueRefs) {
    const normalized = normalizeVaultRef(ref);
    if (normalized.includes("/")) {
      const source = found.byRelativePath.get(normalized);
      if (source) sources.set(ref, source);
      else missing.push(ref);
      continue;
    }
    const candidates = found.byBasename.get(refBasename(ref)) || [];
    if (candidates.length === 1) sources.set(ref, candidates[0].fullPath);
    else if (candidates.length === 0) missing.push(ref);
    else ambiguous.push(`${ref}: ${candidates.map((candidate) => candidate.relativePath).join(", ")}`);
  }

  if (missing.length || ambiguous.length) {
    const issues = [];
    if (missing.length) issues.push(`Missing archive image: ${missing.join(", ")}`);
    if (ambiguous.length) issues.push(`Ambiguous archive image: ${ambiguous.join("; ")}`);
    throw new Error(issues.join(" | "));
  }
  return sources;
}

function isSameOrDescendant(candidate, ancestor) {
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  const normalizedAncestor = path.resolve(ancestor).toLowerCase();
  const boundary = normalizedAncestor.endsWith(path.sep) ? normalizedAncestor : `${normalizedAncestor}${path.sep}`;
  return normalizedCandidate === normalizedAncestor || normalizedCandidate.startsWith(boundary);
}

function pathsOverlap(left, right) {
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

function validateMediaOutputDirectory(mediaOutputDir, workspace, canvasPath, obsidianRoot, sourcePaths = []) {
  const resolved = path.resolve(mediaOutputDir);
  if (
    resolved.toLowerCase() === path.parse(resolved).root.toLowerCase()
    || !isSameOrDescendant(resolved, workspace)
    || isSameOrDescendant(workspace, resolved)
    || pathsOverlap(resolved, canvasPath)
    || pathsOverlap(resolved, obsidianRoot)
    || sourcePaths.some((source) => pathsOverlap(resolved, source))
    || (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory())
  ) {
    throw new Error(`Unsafe archive media output directory: ${resolved}`);
  }
}

function validateOutputPath(outputPath, workspace, mediaOutputDir, canvasPath, obsidianRoot, sourcePaths = []) {
  const resolved = path.resolve(outputPath);
  if (
    pathsOverlap(resolved, mediaOutputDir)
    || !isSameOrDescendant(resolved, workspace)
    || isSameOrDescendant(workspace, resolved)
    || pathsOverlap(resolved, canvasPath)
    || pathsOverlap(resolved, obsidianRoot)
    || sourcePaths.some((source) => pathsOverlap(resolved, source))
    || (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())
  ) {
    throw new Error(`Unsafe archive output path: ${resolved}`);
  }
}

function temporarySibling(targetPath, label) {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

function backupSiblings(targetPath) {
  const directory = path.dirname(targetPath);
  const prefix = `.${path.basename(targetPath)}.backup-`;
  try {
    return fs.readdirSync(directory)
      .filter((name) => name.startsWith(prefix))
      .map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

function cleanupAfterPromotion(targetPath, options, operations, warnings) {
  const exists = operations.exists || fs.existsSync;
  const remove = operations.remove || fs.rmSync;
  const onCleanupWarning = operations.onCleanupWarning || (() => {});
  if (!exists(targetPath)) return true;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      remove(targetPath, options);
      return !exists(targetPath);
    } catch (error) {
      const warning = new Error(`Archive backup cleanup attempt ${attempt} failed for ${targetPath}: ${error.message}`);
      warnings.push(warning);
      onCleanupWarning(warning);
    }
  }
  return !exists(targetPath);
}

export function replaceOutputs({ mediaOutputDir, temporaryMediaDir, outputPath, temporaryOutputPath }, operations = {}) {
  const exists = operations.exists || fs.existsSync;
  const rename = operations.rename || fs.renameSync;
  const remove = operations.remove || fs.rmSync;
  const warnings = [];
  for (const stale of [...backupSiblings(mediaOutputDir), ...backupSiblings(outputPath)]) {
    const cleaned = cleanupAfterPromotion(stale, { recursive: fs.statSync(stale).isDirectory(), force: true }, operations, warnings);
    if (!cleaned) throw new Error(`Unable to clean stale archive backup before promotion: ${stale}`);
  }
  const mediaBackup = temporarySibling(mediaOutputDir, "backup");
  const outputBackup = temporarySibling(outputPath, "backup");
  let mediaBackedUp = false;
  let mediaPromoted = false;
  let outputBackedUp = false;
  let outputPromoted = false;
  try {
    if (exists(mediaOutputDir)) {
      rename(mediaOutputDir, mediaBackup);
      mediaBackedUp = true;
    }
    rename(temporaryMediaDir, mediaOutputDir);
    mediaPromoted = true;
    if (exists(outputPath)) {
      rename(outputPath, outputBackup);
      outputBackedUp = true;
    }
    rename(temporaryOutputPath, outputPath);
    outputPromoted = true;
  } catch (error) {
    if (outputPromoted) remove(outputPath, { force: true });
    if (outputBackedUp) rename(outputBackup, outputPath);
    if (mediaPromoted) remove(mediaOutputDir, { recursive: true, force: true });
    if (mediaBackedUp) rename(mediaBackup, mediaOutputDir);
    throw error;
  }
  if (mediaBackedUp) cleanupAfterPromotion(mediaBackup, { recursive: true, force: true }, operations, warnings);
  if (outputBackedUp) cleanupAfterPromotion(outputBackup, { force: true }, operations, warnings);
  return { cleanupWarnings: warnings };
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeVerifiedJsonOnly(outputPath, payload) {
  const previous = fs.existsSync(outputPath) ? fs.readFileSync(outputPath) : null;
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    if (previous) fs.writeFileSync(outputPath, previous);
    else fs.rmSync(outputPath, { force: true });
    throw error;
  }
}

export function writeArchiveData(options = {}) {
  const workspace = options.workspace || process.cwd();
  const canvasPath = options.canvasPath || canvasPathDefault;
  const obsidianRoot = options.obsidianRoot || obsidianRootDefault;
  const outputPath = options.outputPath || path.join(workspace, "data", "archive.json");
  const mediaOutputDir = options.mediaOutputDir || path.join(workspace, "assets", "canvas-images");
  const copyFile = options.copyFile || fs.copyFileSync;
  const clock = options.clock || (() => new Date());
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};

  validateMediaOutputDirectory(mediaOutputDir, workspace, canvasPath, obsidianRoot);
  validateOutputPath(outputPath, workspace, mediaOutputDir, canvasPath, obsidianRoot);
  const canvas = JSON.parse(fs.readFileSync(canvasPath, "utf8").replace(/^\uFEFF/, ""));
  const archive = parseCanvasArchive(canvas);
  const refs = [...new Set(archive.cases.flatMap((item) => item.images.map((image) => image.originalRef)))];
  onProgress("parsed", { cases: archive.cases.length, imageOccurrences: archive.summary.imageOccurrences });
  const sources = resolveImageSources(refs, obsidianRoot);
  validateMediaOutputDirectory(mediaOutputDir, workspace, canvasPath, obsidianRoot, [...sources.values()]);
  validateOutputPath(outputPath, workspace, mediaOutputDir, canvasPath, obsidianRoot, [...sources.values()]);
  const imagesByRef = new Map();
  for (const item of archive.cases) {
    for (const image of item.images) {
      if (!imagesByRef.has(image.originalRef)) imagesByRef.set(image.originalRef, image);
    }
  }
  const payload = {
    generatedAt: clock().toISOString(),
    source: { canvas: path.basename(canvasPath), visualOrder: "y, x, nodeId" },
    summary: { ...archive.summary, missingImages: 0 },
    cases: archive.cases,
  };

  if (options.reuseExistingMedia) {
    onProgress("verifying-existing-images", { uniqueImages: refs.length, mediaOutputDir });
    if (!fs.existsSync(mediaOutputDir) || !fs.statSync(mediaOutputDir).isDirectory()) {
      throw new Error(`Existing archive media directory is missing: ${mediaOutputDir}`);
    }
    const localFiles = fs.readdirSync(mediaOutputDir, { withFileTypes: true }).filter((entry) => entry.isFile());
    if (localFiles.length !== refs.length) {
      throw new Error(`Existing archive image count mismatch: expected ${refs.length}, got ${localFiles.length}`);
    }
    for (const ref of refs) {
      const localPath = path.join(mediaOutputDir, path.basename(imagesByRef.get(ref).src));
      if (!fs.existsSync(localPath)) throw new Error(`Existing archive image is missing: ${ref}`);
      if (fileSha256(localPath) !== fileSha256(sources.get(ref))) {
        throw new Error(`Existing archive image hash mismatch: ${ref}`);
      }
    }
    writeVerifiedJsonOnly(outputPath, payload);
    onProgress("written", { outputPath, reusedImages: refs.length });
    return payload;
  }

  onProgress("copying-images", { uniqueImages: refs.length, mediaOutputDir });

  const temporaryMediaDir = temporarySibling(mediaOutputDir, "tmp");
  const temporaryOutputPath = temporarySibling(outputPath, "tmp");
  try {
    fs.mkdirSync(temporaryMediaDir, { recursive: true });
    for (const ref of refs) {
      const image = imagesByRef.get(ref);
      copyFile(sources.get(ref), path.join(temporaryMediaDir, path.basename(image.src)));
    }
    const copiedCount = fs.readdirSync(temporaryMediaDir).length;
    if (copiedCount !== refs.length) {
      throw new Error(`Copied archive image count mismatch: expected ${refs.length}, got ${copiedCount}`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(temporaryOutputPath, JSON.stringify(payload, null, 2), "utf8");
    const replacement = replaceOutputs(
      { mediaOutputDir, temporaryMediaDir, outputPath, temporaryOutputPath },
      {
        onCleanupWarning: options.onCleanupWarning || ((warning) => onProgress("cleanup-warning", { message: warning.message })),
      },
    );
    onProgress("written", { outputPath });
    if (replacement.cleanupWarnings.length > 0) {
      onProgress("cleanup-complete", { warnings: replacement.cleanupWarnings.length });
    }
    return payload;
  } catch (error) {
    fs.rmSync(temporaryMediaDir, { recursive: true, force: true });
    fs.rmSync(temporaryOutputPath, { force: true });
    throw error;
  }
}

export function archiveOptionsFromEnvironment(environment = process.env) {
  return {
    workspace: environment.ARCHIVE_WORKSPACE || undefined,
    canvasPath: environment.ARCHIVE_CANVAS_PATH || undefined,
    obsidianRoot: environment.ARCHIVE_OBSIDIAN_ROOT || undefined,
    outputPath: environment.ARCHIVE_OUTPUT_PATH || undefined,
    mediaOutputDir: environment.ARCHIVE_MEDIA_OUTPUT_DIR || undefined,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const payload = writeArchiveData({
    ...archiveOptionsFromEnvironment(),
    onProgress(stage, details) {
      console.error(`[archive-data] ${stage} ${JSON.stringify(details)}`);
    },
  });
  console.log(JSON.stringify(payload.summary));
}
