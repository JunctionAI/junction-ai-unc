import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { integrationManifest } = require("../dist/worker/lib/n8n/integrationManifest.js");
process.stdout.write(JSON.stringify(integrationManifest(), null, 2) + "\n");
