// Downloads the OpenAPI document of a RUNNING API and writes docs/openapi.json.
//   API_URL=http://localhost:4000 node scripts/export-openapi.mjs
// Requires DOCS_ENABLED (default outside production). Regenerate the front/admin TS client from that file.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "openapi.json");

const res = await fetch(`${base}/docs-json`).catch((e) => {
  console.error(`Could not reach ${base}/docs-json: ${e.message}`);
  process.exit(1);
});
if (!res.ok) {
  console.error(`GET ${base}/docs-json -> ${res.status} (is DOCS_ENABLED on?)`);
  process.exit(1);
}
const doc = await res.json();
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
console.log(`Wrote ${out} (${Object.keys(doc.paths ?? {}).length} paths)`);
