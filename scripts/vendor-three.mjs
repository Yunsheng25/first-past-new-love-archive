import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const expectedVersion = "0.160.1";
const expectedSha256 = "3e690ac7d180b0aadf0891bea39eec643e29e2d3e75c99b18689518665f69ba6";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const packagePath = path.join(projectRoot, "node_modules", "three", "package.json");
const sourcePath = path.join(projectRoot, "node_modules", "three", "build", "three.module.min.js");
const vendorDirectory = path.join(projectRoot, "vendor");
const destinationPath = path.join(vendorDirectory, "three.module.min.js");

if (!fs.existsSync(packagePath) || !fs.existsSync(sourcePath)) {
  throw new Error(
    `Three.js ${expectedVersion} is not installed under ${path.dirname(packagePath)}. Run npm install before vendoring.`,
  );
}

const installedPackage = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (installedPackage.version !== expectedVersion) {
  throw new Error(`Expected Three.js ${expectedVersion}, but found ${installedPackage.version ?? "an unknown version"}. Run npm install before vendoring.`);
}

const source = fs.readFileSync(sourcePath);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
if (sourceSha256 !== expectedSha256) {
  throw new Error(`Three.js ${expectedVersion} source hash mismatch: expected ${expectedSha256}, received ${sourceSha256}. Reinstall dependencies before vendoring.`);
}

fs.mkdirSync(vendorDirectory, { recursive: true });
fs.copyFileSync(sourcePath, destinationPath);
