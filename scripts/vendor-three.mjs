import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sourcePath = path.join(projectRoot, "node_modules", "three", "build", "three.module.min.js");
const vendorDirectory = path.join(projectRoot, "vendor");
const destinationPath = path.join(vendorDirectory, "three.module.min.js");

if (!fs.existsSync(sourcePath)) {
  throw new Error(
    `Three.js 0.160.1 is not installed at ${sourcePath}. Run npm install before vendoring.`,
  );
}

fs.mkdirSync(vendorDirectory, { recursive: true });
fs.copyFileSync(sourcePath, destinationPath);
