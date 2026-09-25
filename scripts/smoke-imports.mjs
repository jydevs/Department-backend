// Shopify CSV importer (products + customers) and the maintenance run.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export async function importChecks({ base, check, assert, ownerToken, analystToken }) {
  if (!ownerToken) return console.log("       (no owner token: import flow skipped)");
  try {
    process.loadEnvFile();
  } catch {
    /* optional */
  }
  const api = `${base}/api/v1`;
  const auth = { authorization: `Bearer ${ownerToken}` };
  const items = (x) => (Array.isArray(x) ? x : x.items);

  const upload = async (name, content, type, dryRun, token = ownerToken) => {
    const form = new FormData();
    form.append("file", new Blob([content], { type: "text/csv" }), name);
    form.append("type", type);
    form.append("dryRun", String(dryRun));
    return fetch(`${api}/admin/import/jobs`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  };
  const waitJob = async (res, what) => {
    assert(res.status < 300, `${what}: upload → ${res.status} ${await res.clone().text()}`);
    const { id } = await res.json();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = await (await fetch(`${api}/admin/import/jobs/${id}`, { headers: auth })).json();
      if (["done", "failed", "cancelled"].includes(j.status)) return j;
    }
    throw new Error(`${what}: job ${id} did not finish in 60 s`);
  };
  const productsCsv = readFileSync(join(here, "fixtures", "shopify-products.csv"));
  const customersCsv = readFileSync(join(here, "fixtures", "shopify-customers.csv"));

  await check("import: a location must exist for initial stock (created if missing)", async () => {
    const locs = items(await (await fetch(`${api}/admin/locations`, { headers: auth })).json());
    if (!locs.some((l) => l.isDefault && l.isActive)) {
      const r = await fetch(`${api}/admin/locations`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Bogotá", isDefault: true }) });
      assert(r.status < 300, `create location ${r.status}`);
    }
  });

  await check("import: dry run validates everything and writes nothing", async () => {
    const existing = await (await fetch(`${api}/admin/products?q=camiseta-basica`, { headers: auth })).json();
    const before = items(existing).length;
    const job = await waitJob(await upload("products.csv", productsCsv, "products", true), "dry run");
    assert(job.status === "done" && job.errorCount === 0, `dry run ${job.status}, errors ${JSON.stringify(job.errors).slice(0, 200)}`);
    assert(job.createdCount + job.updatedCount === 3, `planned ${job.createdCount}+${job.updatedCount}`);
    const after = items(await (await fetch(`${api}/admin/products?q=camiseta-basica`, { headers: auth })).json()).length;
    assert(after === before, "dry run wrote products");
  });

  await check("import: real import creates products; the stored HTML is sanitized", async () => {
    const job = await waitJob(await upload("products.csv", productsCsv, "products", false), "import");
    assert(job.status === "done" && job.errorCount === 0, `import ${job.status} ${JSON.stringify(job.errors).slice(0, 300)}`);
    const list = items(await (await fetch(`${api}/admin/products?q=camiseta-basica`, { headers: auth })).json());
    assert(list.length === 1, `expected 1 product, got ${list.length}`);
    const detail = await (await fetch(`${api}/admin/products/${list[0].id}`, { headers: auth })).json();
    const html = detail.descriptionHtml ?? "";
    assert(!/<script|onerror|javascript:/i.test(html), `unsafe HTML survived: ${html.slice(0, 200)}`);
    assert(detail.variants.length === 3, `variants ${detail.variants.length}`);
  });

  await check("import: re-importing the same file is idempotent (updates, no duplicates)", async () => {
    const job = await waitJob(await upload("products.csv", productsCsv, "products", false), "re-import");
    assert(job.status === "done" && job.createdCount === 0 && job.updatedCount === 3, `re-import created ${job.createdCount} updated ${job.updatedCount}`);
    const list = items(await (await fetch(`${api}/admin/products?q=camiseta-basica`, { headers: auth })).json());
    assert(list.length === 1, "duplicate product created");
  });

  await check("import: a malformed CSV fails the job with a readable message", async () => {
    const job = await waitJob(await upload("bad.csv", 'Handle,Title\n"unterminated,Hello\n', "products", true), "bad csv");
    assert(job.status === "failed", `status ${job.status}`);
    assert(JSON.stringify(job.errors).length > 5, "no error message");
  });

  await check("import: non-CSV / binary uploads are refused (415)", async () => {
    const r = await upload("evil.csv", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01]), "products", true);
    assert(r.status === 415, `binary → ${r.status}`);
  });

  await check("import: customers are created as guests without a password and can set one via reset", async () => {
    const job = await waitJob(await upload("customers.csv", customersCsv, "customers", false), "customers");
    assert(job.status === "done" && job.errorCount === 0, `customers ${job.status} ${JSON.stringify(job.errors).slice(0, 300)}`);
    if (!process.env.DATABASE_URL) return;
    const require = createRequire(import.meta.url);
    const { Client } = require("pg");
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const rows = (await db.query("SELECT email, password_hash, email_verified_at FROM customers WHERE 'shopify-import' = ANY(tags) ORDER BY created_at DESC LIMIT 3")).rows;
      assert(rows.length >= 3, `only ${rows.length} imported customers`);
      assert(rows.every((r) => r.password_hash === null && r.email_verified_at === null), "imported customers must not have a password or verified e-mail");
      const email = rows[0].email;
      const f = await fetch(`${api}/storefront/customers/forgot-password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      assert(f.status === 202, `forgot → ${f.status}`);
      let queued = 0;
      for (let i = 0; i < 10 && !queued; i++) {
        await new Promise((r) => setTimeout(r, 500));
        queued = (await db.query("SELECT 1 FROM email_outbox WHERE \"to\" = $1 AND template = 'password_reset'", [email])).rowCount;
      }
      assert(queued, "no password_reset e-mail for the imported customer");
    } finally {
      await db.end();
    }
  });

  await check("import + maintenance: analysts are forbidden; the maintenance run reports per task", async () => {
    if (analystToken) {
      const denied = await upload("products.csv", productsCsv, "products", true, analystToken);
      assert(denied.status === 403, `analyst import → ${denied.status}`);
      const m = await fetch(`${api}/admin/maintenance/run`, { method: "POST", headers: { authorization: `Bearer ${analystToken}` } });
      assert(m.status === 403, `analyst maintenance → ${m.status}`);
    }
    const run = await fetch(`${api}/admin/maintenance/run`, { method: "POST", headers: auth });
    assert(run.status < 300, `maintenance → ${run.status} ${await run.clone().text()}`);
    const j = await run.json();
    assert(Array.isArray(j.tasks) && j.tasks.every((t) => !t.error), `maintenance errors: ${JSON.stringify(j.tasks?.filter((t) => t.error))}`);
  });
}
