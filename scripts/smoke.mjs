// Smoke check against a running API:  API_URL=http://localhost:4000 yarn smoke
const base = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

console.log(`Smoke → ${base}`);

await check("GET /health → 200 ok", async () => {
  const r = await fetch(`${base}/health`);
  assert(r.status === 200, `status ${r.status}`);
  assert((await r.json()).status === "ok", "body");
});

await check("GET /ready → 200 (database up)", async () => {
  const r = await fetch(`${base}/ready`);
  assert(r.status === 200, `status ${r.status}`);
});

await check("GET /version has name + version", async () => {
  const j = await (await fetch(`${base}/version`)).json();
  assert(j.name && j.version, JSON.stringify(j));
});

await check("unknown route → JSON 404 with requestId", async () => {
  const r = await fetch(`${base}/api/v1/does-not-exist`);
  const j = await r.json();
  assert(r.status === 404, `status ${r.status}`);
  assert(j.code === "NOT_FOUND" && j.requestId, JSON.stringify(j));
  assert(!JSON.stringify(j).includes("stack"), "stack leaked");
});

await check("x-request-id is echoed (valid) or replaced (invalid)", async () => {
  const good = await fetch(`${base}/health`, { headers: { "x-request-id": "abc12345-req" } });
  assert(good.headers.get("x-request-id") === "abc12345-req", "valid id not echoed");
  const bad = await fetch(`${base}/health`, { headers: { "x-request-id": "bad id with spaces & <script>" } });
  assert(/^[0-9a-f-]{36}$/.test(bad.headers.get("x-request-id") ?? ""), "unsafe id not replaced by a uuid");
});

await check("security headers present, x-powered-by absent", async () => {
  const r = await fetch(`${base}/health`);
  assert(r.headers.get("x-content-type-options") === "nosniff", "nosniff");
  assert(!r.headers.get("x-powered-by"), "x-powered-by leaked");
});

await check("OpenAPI document served at /docs-json", async () => {
  const r = await fetch(`${base}/docs-json`);
  if (r.status === 404) return console.log("       (docs disabled — skipped)");
  const j = await r.json();
  assert(j.openapi && j.paths, "not an OpenAPI doc");
});

await check("CORS: allowed origin echoed, foreign origin not", async () => {
  const ok = await fetch(`${base}/health`, { headers: { origin: "http://localhost:3000" } });
  assert(ok.headers.get("access-control-allow-origin") === "http://localhost:3000", "allowed origin");
  const bad = await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } });
  assert(bad.headers.get("access-control-allow-origin") !== "https://evil.example", "foreign origin allowed");
});

import { identityChecks } from "./smoke-identity.mjs";
import { catalogChecks } from "./smoke-catalog.mjs";
const tokens = await identityChecks({ base, check, assert });
await catalogChecks({ base, check, assert, ...tokens });

console.log(failed ? `\n${failed} check(s) failed` : "\nAll smoke checks passed");
process.exit(failed ? 1 : 0);
