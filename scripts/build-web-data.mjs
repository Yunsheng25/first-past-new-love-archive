import path from "node:path";
import { fileURLToPath } from "node:url";

import { archiveOptionsFromEnvironment, writeArchiveData } from "./build-archive-data.mjs";

export { writeArchiveData } from "./build-archive-data.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const payload = writeArchiveData(archiveOptionsFromEnvironment());
  console.log(JSON.stringify(payload.summary));
}
