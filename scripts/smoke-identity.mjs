// Identity flow checks. NOTE: login is throttled to 5/min/IP and this flow uses 5 logins, so wait a minute (or restart the API) between runs.
// Imported by smoke.mjs; needs OWNER_EMAIL / OWNER_PASSWORD (an existing owner).
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
  if (!owner) { console.log("       (set OWNER_EMAIL/OWNER_PASSWORD to run the identity flow)"); return {}; }

  let token;
  let cookie;
  let analystToken;

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

  const cookieOf = (r) => (r.headers.get("set-cookie") ?? "").split(";")[0];
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  await check("refresh rotates; a concurrent reuse inside the 20 s grace gets an access token only (no cookie, family alive)", async () => {
    const r1 = await post("/auth/refresh", {}, null, { cookie });
    assert(r1.status < 300, `refresh status ${r1.status}`);
    const c1 = cookieOf(r1);
    assert(c1 && c1 !== cookie, "no rotated cookie");
    const grace = await post("/auth/refresh", {}, null, { cookie }); // two tabs / a retry with the cookie that was just rotated
    assert(grace.status < 300 && (await grace.json()).accessToken, `grace reuse → ${grace.status}`);
    assert(!cookieOf(grace), "grace reply must not set a cookie (it would overwrite the winner's)");
    const alive = await post("/auth/refresh", {}, null, { cookie: c1 });
    assert(alive.status < 300, `the family must survive the grace reuse: ${alive.status}`);
  });

  await check("two simultaneous refreshes with one cookie: exactly one rotates (the other gets no cookie)", async () => {
    const l = await post("/auth/login", owner);
    const c0 = cookieOf(l);
    const [x, y] = await Promise.all([post("/auth/refresh", {}, null, { cookie: c0 }), post("/auth/refresh", {}, null, { cookie: c0 })]);
    assert(x.status < 300 && y.status < 300, `${x.status}/${y.status}`);
    assert([x, y].filter((r) => cookieOf(r)).length === 1, "exactly one response must carry the rotated cookie");
  });

  await check("reusing a rotated token AFTER the grace revokes the whole family (the fresh token dies too)", async () => {
    const l = await post("/auth/login", owner);
    const c0 = cookieOf(l);
    const r1 = await post("/auth/refresh", {}, null, { cookie: c0 });
    const c1 = cookieOf(r1);
    assert(r1.status < 300 && c1, "rotation failed");
    await sleep(21_000);
    const replay = await post("/auth/refresh", {}, null, { cookie: c0 }); // attacker replays the old one
    assert(replay.status === 401, `late reuse → ${replay.status}`);
    const r2 = await post("/auth/refresh", {}, null, { cookie: c1 });
    assert(r2.status === 401, `legit token still alive: ${r2.status}`);
  });

  // the access token is stateless: it keeps working after its refresh family died
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
    analystToken = (await login.json()).accessToken;
    const denied = await post(
      "/admin/staff",
      { email: `x${Date.now()}@dept.test`, fullName: "X", roleId: analyst.id },
      analystToken,
    );
    assert(denied.status === 403, `got ${denied.status}`);
  });
  return { ownerToken: token, analystToken };
}
