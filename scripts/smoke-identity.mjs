// Identity flow checks. Imported by smoke.mjs; needs OWNER_EMAIL / OWNER_PASSWORD (an existing owner).
export async function identityChecks({ base, check, assert }) {
  const api = `${base}/api/v1`;
  const post = (path, body, token, headers = {}) =>
    fetch(`${api}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify(body ?? {}),
    });
  const get = (path, token) => fetch(`${api}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

  await check("admin route without token → 401", async () => {
    const r = await get("/admin/staff");
    assert(r.status === 401, `got ${r.status}`);
  });

  const owner =
    process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD
      ? { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD }
      : null;
  if (!owner) return console.log("       (set OWNER_EMAIL/OWNER_PASSWORD to run the identity flow)");

  let token;
  let cookie;

  await check("login rejects a wrong password (401 INVALID_CREDENTIALS)", async () => {
    const r = await post("/auth/login", { email: owner.email, password: "definitely-wrong-password" });
    assert(r.status === 401 && (await r.json()).code === "INVALID_CREDENTIALS", `status ${r.status}`);
  });

  await check("login → access token + httpOnly refresh cookie", async () => {
    const r = await post("/auth/login", owner);
    assert(r.status < 300, `status ${r.status}`);
    const setCookie = r.headers.get("set-cookie") ?? "";
    const j = await r.json();
    token = j.accessToken;
    cookie = setCookie.split(";")[0];
    assert(token && /HttpOnly/i.test(setCookie), "missing token or HttpOnly cookie");
    assert(!JSON.stringify(j).includes("passwordHash"), "password hash leaked");
  });

  await check("GET /auth/me → 200", async () => {
    const r = await get("/auth/me", token);
    assert(r.status === 200, `status ${r.status}`);
  });

  await check("refresh rotates; reusing the old cookie is rejected", async () => {
    const r1 = await post("/auth/refresh", {}, null, { cookie });
    assert(r1.status < 300, `refresh status ${r1.status}`);
    const r2 = await post("/auth/refresh", {}, null, { cookie });
    assert(r2.status === 401, `reuse status ${r2.status}`);
  });

  // the reuse above revoked the whole family: sign in again for the rest
  const relog = await post("/auth/login", owner);
  token = (await relog.json()).accessToken;

  await check("owner can list staff, roles and audit logs (200)", async () => {
    for (const p of ["/admin/staff", "/admin/roles", "/admin/audit-logs"]) {
      const r = await get(p, token);
      assert(r.status === 200, `${p} → ${r.status}`);
    }
  });

  await check("analyst role is forbidden from creating staff (403)", async () => {
    const roles = await (await get("/admin/roles", token)).json();
    const analyst = (Array.isArray(roles) ? roles : roles.items).find((r) => r.key === "analyst");
    const email = `analyst-${Date.now()}@dept.test`;
    const created = await post("/admin/staff", { email, fullName: "Smoke Analyst", roleId: analyst.id }, token);
    assert(created.status < 300, `create status ${created.status}`);
    const temp = (await created.json()).password;
    const login = await post("/auth/login", { email, password: temp });
    const analystToken = (await login.json()).accessToken;
    const denied = await post(
      "/admin/staff",
      { email: `x${Date.now()}@dept.test`, fullName: "X", roleId: analyst.id },
      analystToken,
    );
    assert(denied.status === 403, `got ${denied.status}`);
  });
}
