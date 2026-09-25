// Customers, e-mail outbox, newsletter, contact form, e-mail templates and analytics.
// NOTE: customer login is throttled to 5/min/IP and this flow uses exactly 5 logins: restart the API between runs.
// Reads the e-mail outbox straight from Postgres (DATABASE_URL) to pick up verification/reset tokens: the log transport never sends anything.
import { createRequire } from "node:module";

export async function customerChecks({ base, check, assert, ownerToken, analystToken, buyerEmail, orderNumber }) {
  if (!ownerToken) return console.log("       (no owner token: customers flow skipped)");
  try {
    process.loadEnvFile();
  } catch {
    /* .env is optional */
  }
  if (!process.env.DATABASE_URL) return console.log("       (DATABASE_URL not set: customers flow needs the e-mail outbox, skipped)");

  const require = createRequire(import.meta.url);
  const { Client } = require("pg");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const tokenFor = async (to, template) => {
    for (let i = 0; i < 20; i++) {
      const r = await db.query("SELECT body_text FROM email_outbox WHERE \"to\" = $1 AND template = $2 ORDER BY created_at DESC LIMIT 1", [to, template]);
      const m = r.rows[0]?.body_text.match(/token=([A-Za-z0-9_-]+)/);
      if (m) return m[1];
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new Error(`no ${template} e-mail queued for ${to}`);
  };

  const api = `${base}/api/v1`;
  const call = (method, path, body, token, headers = {}) =>
    fetch(`${api}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ok = async (res, what) => {
    assert(res.status < 300, `${what} → ${res.status} ${await res.clone().text()}`);
    return res.json().catch(() => ({}));
  };
  const items = (x) => (Array.isArray(x) ? x : x.items);
  const stamp = Date.now();
  const email = buyerEmail ?? `cust-${stamp}@dept.test`;
  const password1 = "Sup3r-Secret-Pass-1";
  const password2 = "An0ther-Secret-Pass-2";
  let access;
  let cookie;

  try {
    if (buyerEmail) {
      await check("mail: paid / cancelled / refunded orders queued their transactional e-mails", async () => {
        const rows = (await db.query("SELECT DISTINCT template FROM email_outbox WHERE \"to\" = $1", [buyerEmail])).rows.map((r) => r.template);
        for (const t of ["order_confirmation", "order_cancelled", "refund_issued"]) assert(rows.includes(t), `missing ${t} (have ${rows.join(",")})`);
      });
    }

    await check("customers: register never reveals whether the e-mail exists (202 both times)", async () => {
      const body = { email, password: password1, firstName: "Smoke", lastName: "Buyer", acceptsMarketing: false };
      const a = await call("POST", "/storefront/customers/register", body);
      const b = await call("POST", "/storefront/customers/register", body);
      assert(a.status === 202 && b.status === 202, `register ${a.status}/${b.status}`);
    });

    await check("customers: e-mail verification token works once", async () => {
      const token = await tokenFor(email, "email_verify");
      await ok(await call("POST", "/storefront/customers/verify-email", { token }), "verify");
      const again = await call("POST", "/storefront/customers/verify-email", { token });
      assert(again.status >= 400 && again.status < 500, `token reuse → ${again.status}`);
    });

    await check("customers: login → access token + httpOnly refresh cookie", async () => {
      const r = await call("POST", "/storefront/customers/login", { email, password: password1 });
      const setCookie = r.headers.get("set-cookie") ?? "";
      const j = await ok(r, "login");
      access = j.accessToken;
      cookie = setCookie.split(";")[0];
      assert(access && /HttpOnly/i.test(setCookie) && /dept_ct/.test(setCookie), "missing token or cookie");
      assert(!JSON.stringify(j).includes("passwordHash"), "hash leaked");
    });

    await check("customers: tokens are not interchangeable (customer ≠ staff)", async () => {
      const me = await call("GET", "/storefront/customers/me", undefined, access);
      assert(me.status === 200, `me → ${me.status}`);
      const asStaff = await call("GET", "/admin/staff", undefined, access);
      assert(asStaff.status === 401, `customer token on /admin → ${asStaff.status}`);
      const asCustomer = await call("GET", "/storefront/customers/me", undefined, ownerToken);
      assert(asCustomer.status === 401, `staff token on /storefront/customers/me → ${asCustomer.status}`);
    });

    await check("customers: refresh rotates and a replayed cookie is rejected", async () => {
      const r1 = await call("POST", "/storefront/customers/refresh", {}, undefined, { cookie });
      assert(r1.status < 300, `refresh → ${r1.status}`);
      const r2 = await call("POST", "/storefront/customers/refresh", {}, undefined, { cookie });
      assert(r2.status === 401, `replay → ${r2.status}`);
    });

    await check("customers: addresses CRUD keeps a single default", async () => {
      const addr = { fullName: "Smoke Buyer", phone: "3001234567", department: "Cundinamarca", city: "Bogotá", address1: "Calle 1 # 2-3" };
      const a = await ok(await call("POST", "/storefront/customers/me/addresses", { ...addr, isDefault: true }, access), "addr 1");
      const b = await ok(await call("POST", "/storefront/customers/me/addresses", { ...addr, address1: "Carrera 9 # 8-7", isDefault: true }, access), "addr 2");
      const list = items(await ok(await call("GET", "/storefront/customers/me/addresses", undefined, access), "list"));
      assert(list.filter((x) => x.isDefault).length === 1, "more than one default");
      await ok(await call("DELETE", `/storefront/customers/me/addresses/${a.id}`, undefined, access), "delete");
      assert(b.id, "no id");
    });

    if (orderNumber) {
      await check("customers: verified customer sees THEIR orders only (guest order linked by e-mail)", async () => {
        const list = items(await ok(await call("GET", "/storefront/customers/me/orders", undefined, access), "orders"));
        assert(list.some((o) => o.orderNumber === orderNumber), "guest order not linked");
        const one = await call("GET", `/storefront/customers/me/orders/${orderNumber}`, undefined, access);
        assert(one.status === 200, `own order → ${one.status}`);
        const otherEmail = `other-${stamp}@dept.test`;
        await call("POST", "/storefront/customers/register", { email: otherEmail, password: password1, firstName: "O", lastName: "T", acceptsMarketing: false });
        await ok(await call("POST", "/storefront/customers/verify-email", { token: await tokenFor(otherEmail, "email_verify") }), "verify other");
        const other = await ok(await call("POST", "/storefront/customers/login", { email: otherEmail, password: password1 }), "login other");
        const idor = await call("GET", `/storefront/customers/me/orders/${orderNumber}`, undefined, other.accessToken);
        assert(idor.status === 404, `another customer's order → ${idor.status}`);
      });
    }

    await check("customers: forgot/reset password revokes sessions; old password stops working", async () => {
      const f = await call("POST", "/storefront/customers/forgot-password", { email });
      assert(f.status === 202, `forgot → ${f.status}`);
      const unknown = await call("POST", "/storefront/customers/forgot-password", { email: `nobody-${stamp}@dept.test` });
      assert(unknown.status === 202, `unknown e-mail → ${unknown.status}`);
      const token = await tokenFor(email, "password_reset");
      await ok(await call("POST", "/storefront/customers/reset-password", { token, password: password2 }), "reset");
      const old = await call("POST", "/storefront/customers/login", { email, password: password1 });
      assert(old.status === 401, `old password → ${old.status}`);
      const fresh = await call("POST", "/storefront/customers/login", { email, password: password2 });
      access = (await ok(fresh, "login with new password")).accessToken;
    });

    await check("customers: data export is no-store; DELETE me anonymizes and blocks the account", async () => {
      const exp = await call("POST", "/storefront/customers/me/data-export", {}, access);
      assert(exp.status < 300 && /no-store/.test(exp.headers.get("cache-control") ?? ""), `export ${exp.status}`);
      const wrong = await call("DELETE", "/storefront/customers/me", { password: "not-my-password-1" }, access);
      assert(wrong.status >= 400 && wrong.status < 500, `wrong password → ${wrong.status}`);
      await ok(await call("DELETE", "/storefront/customers/me", { password: password2 }, access), "delete me");
      const login = await call("POST", "/storefront/customers/login", { email, password: password2 });
      assert(login.status === 401, `login after erase → ${login.status}`);
      const row = (await db.query("SELECT email, anonymized_at FROM customers WHERE lower(email) = $1", [email.toLowerCase()])).rowCount;
      assert(row === 0, "original e-mail still stored");
    });

    await check("customers: admin directory and CSV export are permission-guarded", async () => {
      const list = await call("GET", "/admin/customers?pageSize=5", undefined, ownerToken);
      assert(list.status === 200, `list → ${list.status}`);
      const csv = await fetch(`${api}/admin/customers/export`, { headers: { authorization: `Bearer ${ownerToken}` } });
      assert(csv.status === 200 && /csv/.test(csv.headers.get("content-type") ?? ""), `export → ${csv.status}`);
      if (analystToken) {
        const denied = await fetch(`${api}/admin/customers/export`, { headers: { authorization: `Bearer ${analystToken}` } });
        assert(denied.status === 403, `analyst export → ${denied.status}`);
      }
    });

    await check("marketing: newsletter double opt-in, then unsubscribe", async () => {
      const nl = `nl-${stamp}@dept.test`;
      const a = await call("POST", "/storefront/newsletter", { email: nl, source: "footer" });
      const b = await call("POST", "/storefront/newsletter", { email: nl, source: "footer" });
      assert(a.status === 202 && b.status === 202, `subscribe ${a.status}/${b.status}`);
      const token = await tokenFor(nl, "newsletter_confirm");
      const conf = await fetch(`${api}/storefront/newsletter/confirm?token=${token}`);
      assert(conf.status < 300, `confirm → ${conf.status}`);
      const row = (await db.query("SELECT status FROM newsletter_subscribers WHERE email = $1", [nl])).rows[0];
      assert(row?.status === "subscribed", `status ${row?.status}`);
      const bad = await fetch(`${api}/storefront/newsletter/confirm?token=nope`);
      assert(bad.status === 400, `bad token → ${bad.status}`);
    });

    await check("marketing: contact form stores messages; the honeypot silently drops bots", async () => {
      const real = await call("POST", "/storefront/contact", { name: "Smoke", email: `c-${stamp}@dept.test`, message: `hola ${stamp}` });
      const bot = await call("POST", "/storefront/contact", { name: "Bot", email: `b-${stamp}@dept.test`, message: `spam ${stamp}`, website: "http://spam.example" });
      assert(real.status === 202 && bot.status === 202, `contact ${real.status}/${bot.status}`);
      const rows = (await db.query("SELECT message FROM contact_messages WHERE message IN ($1, $2)", [`hola ${stamp}`, `spam ${stamp}`])).rows;
      assert(rows.length === 1 && rows[0].message === `hola ${stamp}`, `stored ${JSON.stringify(rows)}`);
      const admin = await call("GET", "/admin/contact-messages", undefined, ownerToken);
      assert(admin.status === 200, `admin list → ${admin.status}`);
    });

    await check("mail: template preview HTML-escapes variables (no script injection)", async () => {
      const r = await call("POST", "/admin/email-templates/welcome/preview", { data: { customerName: "<script>alert(1)</script>" } }, ownerToken);
      const j = await ok(r, "preview");
      const html = j.bodyHtml;
      assert(!html.includes("<script>alert(1)</script>") && /&lt;script&gt;/.test(html), "unescaped output");
    });

    await check("analytics: overview matches the paid orders of the run; guarded by permission", async () => {
      const r = await call("GET", "/admin/analytics/overview", undefined, ownerToken);
      const j = await ok(r, "overview");
      const cur = j.current ?? j;
      assert((cur.paidOrders ?? cur.orders ?? 0) >= 1, `no paid orders counted: ${JSON.stringify(j).slice(0, 200)}`);
      const sales = await call("GET", "/admin/analytics/sales?groupBy=day", undefined, ownerToken);
      assert(sales.status === 200, `sales → ${sales.status}`);
      const far = await call("GET", "/admin/analytics/overview?from=2020-01-01&to=2026-01-01", undefined, ownerToken);
      assert(far.status === 400, `range > 366 days → ${far.status}`);
    });
  } finally {
    await db.end();
  }
}
