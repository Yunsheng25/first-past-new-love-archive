import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function replaceOutputs({ mediaOutputDir, temporaryMediaDir, outputPath, temporaryOutputPath }) {
  const mediaBackup = temporarySibling(mediaOutputDir, "backup");
  const outputBackup = temporarySibling(outputPath, "backup");
  let mediaBackedUp = false;
  let mediaPromoted = false;
  let outputBackedUp = false;
  let outputPromoted = false;
  try {
    if (fs.existsSync(mediaOutputDir)) {
      fs.renameSync(mediaOutputDir, mediaBackup);
      mediaBackedUp = true;
    }
    fs.renameSync(temporaryMediaDir, mediaOutputDir);
    mediaPromoted = true;
    if (fs.existsSync(outputPath)) {
      fs.renameSync(outputPath, outputBackup);
      outputBackedUp = true;
    }
    fs.renameSync(temporaryOutputPath, outputPath);
    outputPromoted = true;
  } catch (error) {
    if (outputPromoted) fs.rmSync(outputPath, { force: true });
    if (outputBackedUp) fs.renameSync(outputBackup, outputPath);
    if (mediaPromoted) fs.rmSync(mediaOutputDir, { recursive: true, force: true });
    if (mediaBackedUp) fs.renameSync(mediaBackup, mediaOutputDir);
    throw error;
  }
  if (mediaBackedUp) fs.rmSync(mediaBackup, { recursive: true, force: true });
  if (outputBackedUp) fs.rmSync(outputBackup, { force: true });
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
  onProgress("copying-images", { uniqueImages: refs.length, mediaOutputDir });

  const temporaryMediaDir = temporarySibling(mediaOutputDir, "tmp");
  const temporaryOutputPath = temporarySibling(outputPath, "tmp");
  try {
    fs.mkdirSync(temporaryMediaDir, { recursive: true });
    for (const ref of refs) {
      const image = archive.cases.flatMap((item) => item.images).find((candidate) => candidate.originalRef === ref);
      copyFile(sources.get(ref), path.join(temporaryMediaDir, path.basename(image.src)));
    }
    const copiedCount = fs.readdirSync(temporaryMediaDir).length;
    if (copiedCount !== refs.length) {
      throw new Error(`Copied archive image count mismatch: expected ${refs.length}, got ${copiedCount}`);
    }

    const payload = {
      generatedAt: clock().toISOString(),
      source: { canvas: path.basename(canvasPath), visualOrder: "y, x, nodeId" },
      summary: { ...archive.summary, missingImages: 0 },
      cases: archive.cases,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(temporaryOutputPath, JSON.stringify(payload, null, 2), "utf8");
    replaceOutputs({ mediaOutputDir, temporaryMediaDir, outputPath, temporaryOutputPath });
    onProgress("written", { outputPath });
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
