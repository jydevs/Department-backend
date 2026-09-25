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

  const stamp = Date.now().toString(36);
  const withDb = async (fn) => {
    if (!process.env.DATABASE_URL) return console.log("       (no DATABASE_URL: skipped)");
    const require = createRequire(import.meta.url);
    const { Client } = require("pg");
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await fn(db);
    } finally {
      await db.end();
    }
  };
  const seedCustomer = (db, email, { password, verified, marketing = false, consentAt = null, first = "Original" }) =>
    db.query(
      `INSERT INTO customers (id, email, password_hash, first_name, last_name, accepts_marketing, marketing_consent_at, email_verified_at, version)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Owner', $4, $5, $6, 1) RETURNING id`,
      [email, password ? "$argon2id$dummy" : null, first, marketing, consentAt, verified ? new Date() : null],
    );

  await check("import: an existing UNVERIFIED account with a password is skipped and gets no personal data (H-1)", () =>
    withDb(async (db) => {
      const email = `victim-${stamp}@example.com`;
      const { rows } = await seedCustomer(db, email, { password: true, verified: false });
      const csv = `Email,First Name,Last Name,Phone,Accepts Email Marketing,Default Address Address1,Default Address City,Default Address Province,Default Address Phone\n${email},Real,Person,+573001112233,yes,Calle 1 # 2-3,Bogota,Cundinamarca,+573001112233\n`;
      const job = await waitJob(await upload("unverified.csv", csv, "customers", false), "unverified account");
      assert(job.status === "done" && job.errors.some((e) => e.code === "ACCOUNT_UNVERIFIED_SKIPPED"), `errors ${JSON.stringify(job.errors)}`);
      const c = (await db.query("SELECT first_name, phone, accepts_marketing FROM customers WHERE id = $1", [rows[0].id])).rows[0];
      assert(c.first_name === "Original" && c.phone === null && c.accepts_marketing === false, `PII merged: ${JSON.stringify(c)}`);
      assert((await db.query("SELECT 1 FROM customer_addresses WHERE customer_id = $1", [rows[0].id])).rowCount === 0, "address added to an unverified account");
    }));

  await check("import: never re-subscribes an opted-out customer nor changes an existing consent date (M-1)", () =>
    withDb(async (db) => {
      const optedOut = `optout-${stamp}@example.com`;
      const consented = `consent-${stamp}@example.com`;
      const when = new Date("2024-01-02T03:04:05Z");
      await seedCustomer(db, optedOut, { password: true, verified: true, marketing: false });
      await seedCustomer(db, consented, { password: true, verified: true, marketing: true, consentAt: when });
      const csv = `Email,First Name,Last Name,Accepts Email Marketing\n${optedOut},Nuevo,Nombre,yes\n${consented},Otro,Nombre,yes\n`;
      const job = await waitJob(await upload("resub.csv", csv, "customers", false), "resubscribe");
      assert(job.status === "done" && job.errorCount === 0, `errors ${JSON.stringify(job.errors)}`);
      const a = (await db.query("SELECT accepts_marketing, marketing_consent_at FROM customers WHERE email = $1", [optedOut])).rows[0];
      assert(a.accepts_marketing === false && a.marketing_consent_at === null, `opted-out customer re-subscribed: ${JSON.stringify(a)}`);
      const b = (await db.query("SELECT marketing_consent_at FROM customers WHERE email = $1", [consented])).rows[0];
      assert(new Date(b.marketing_consent_at).getTime() === when.getTime(), "existing consent date changed");
    }));

  await check("import: an erased data subject is not recreated (SUPPRESSED, Habeas Data)", () =>
    withDb(async (db) => {
      const email = `erased-${stamp}@example.com`;
      const { rows } = await seedCustomer(db, email, { password: false, verified: false });
      const erase = await fetch(`${api}/admin/customers/${rows[0].id}/erase`, { method: "POST", headers: auth });
      assert(erase.status < 300, `erase → ${erase.status} ${await erase.text()}`);
      const csv = `Email,First Name,Last Name,Accepts Email Marketing\n${email},Ghost,Person,yes\n`;
      const job = await waitJob(await upload("erased.csv", csv, "customers", false), "erased subject");
      assert(job.errors.some((e) => e.code === "SUPPRESSED"), `errors ${JSON.stringify(job.errors)}`);
      assert((await db.query("SELECT 1 FROM customers WHERE email = $1", [email])).rowCount === 0, "the erased customer was recreated");
      assert((await db.query("SELECT 1 FROM erasure_suppressions WHERE email_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [email])).rowCount === 1, "no suppression hash stored");
    }));

  await check("import: a partial CSV (absent columns) does not degrade an existing product (M-3)", async () => {
    const handle = `smoke-partial-${stamp}`;
    const sku = `SMK-${stamp}`;
    const full = `Handle,Title,Body (HTML),Vendor,Tags,Status,Variant SKU,Variant Price,Variant Compare At Price\n${handle},Smoke Partial,<p>Hola</p>,Dept,"a,b",active,${sku},50000,70000\n`;
    const j1 = await waitJob(await upload("full.csv", full, "products", false), "full product");
    assert(j1.status === "done" && j1.errorCount === 0, `full ${JSON.stringify(j1.errors)}`);
    const partial = `Handle,Title,Variant Price\n${handle},Smoke Partial,60000\n`;
    const j2 = await waitJob(await upload("partial.csv", partial, "products", false), "partial product");
    assert(j2.status === "done" && j2.errorCount === 0, `partial ${JSON.stringify(j2.errors)}`);
    const list = items(await (await fetch(`${api}/admin/products?q=${handle}`, { headers: auth })).json());
    assert(list.length === 1, "product not found");
    const p = await (await fetch(`${api}/admin/products/${list[0].id}`, { headers: auth })).json();
    assert(p.status === "active", `status degraded to ${p.status}`);
    assert(p.descriptionHtml.includes("Hola") && p.vendor === "Dept" && p.tags.length === 2, `fields wiped: ${JSON.stringify({ d: p.descriptionHtml, v: p.vendor, t: p.tags })}`);
    const v = p.variants[0];
    assert(v.price === 60000 && v.sku === sku && v.compareAtPrice === 70000, `variant: ${JSON.stringify(v)}`);
  });

  await check("admin API: descriptionHtml of products and collections is sanitized server side (M-5)", async () => {
    const dirty = '<p onclick="x()">Hi</p><script>alert(1)</script><img src="javascript:alert(1)" onerror="x()"><a href="javascript:alert(1)">l</a>';
    const create = await fetch(`${api}/admin/products`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ title: `Xss ${stamp}`, descriptionHtml: dirty }) });
    assert(create.status < 300, `create product ${create.status} ${await create.clone().text()}`);
    const product = await create.json();
    const detail = await (await fetch(`${api}/admin/products/${product.id}`, { headers: auth })).json();
    assert(detail.descriptionHtml.includes("Hi") && !/<script|onerror|onclick|javascript:/i.test(detail.descriptionHtml), `unsafe: ${detail.descriptionHtml}`);
    const upd = await fetch(`${api}/admin/products/${product.id}`, { method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ version: detail.version, descriptionHtml: dirty }) });
    assert(upd.status < 300, `update product ${upd.status} ${await upd.clone().text()}`);
    const col = await fetch(`${api}/admin/collections`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ title: `Xss ${stamp}`, handle: `xss-${stamp}`, type: "manual", descriptionHtml: dirty }) });
    assert(col.status < 300, `create collection ${col.status} ${await col.clone().text()}`);
    const collection = await col.json();
    assert(!/<script|onerror|onclick|javascript:/i.test(collection.descriptionHtml ?? ""), `unsafe collection: ${collection.descriptionHtml}`);
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
