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
    const first = await post("/auth/login", { email, password: temp });
    const firstBody = await first.json();
    assert(firstBody.mustChangePassword === true && firstBody.twoFactorSetupRequired === false, `login flags ${JSON.stringify(firstBody)}`);
    // temporary password: only me/logout/refresh/change-password work until it is replaced
    const me0 = await (await get("/auth/me", firstBody.accessToken)).json();
    assert(me0.mustChangePassword === true, "me.mustChangePassword");
    const blocked = await get("/admin/products", firstBody.accessToken);
    const blockedBody = await blocked.json();
    assert(blocked.status === 403 && blockedBody.code === "PASSWORD_CHANGE_REQUIRED", `pending password → ${blocked.status} ${JSON.stringify(blockedBody)}`);
    const same = await post("/auth/change-password", { current: temp, new: temp }, firstBody.accessToken);
    const sameBody = await same.json();
    assert(same.status === 422 && sameBody.code === "PASSWORD_UNCHANGED", `new == current → ${same.status} ${JSON.stringify(sameBody)}`);
    const newPassword = `Smoke-${Date.now()}-Pass!`;
    const changed = await post("/auth/change-password", { current: temp, new: newPassword }, firstBody.accessToken);
    assert(changed.status < 300, `change-password → ${changed.status}`);
    const changedBody = await changed.json();
    const changedCookie = (changed.headers.get("set-cookie") ?? "").split(";")[0];
    assert(
      changedBody.accessToken && changedBody.expiresIn > 0 && changedBody.mustChangePassword === false && changedBody.twoFactorSetupRequired === false && changedBody.user?.email === email,
      `change-password must return a new session: ${JSON.stringify(changedBody)}`,
    );
    assert(/^dept_rt=/.test(changedCookie) && /HttpOnly/i.test(changed.headers.get("set-cookie") ?? ""), "change-password must set the new dept_rt cookie");
    assert((await get("/auth/me", changedBody.accessToken)).status === 200, "the returned access token must work");
    assert((await post("/auth/refresh", {}, null, { cookie: changedCookie })).status < 300, "the returned refresh cookie must work");
    assert((await post("/auth/refresh", {}, null, { cookie: (first.headers.get("set-cookie") ?? "").split(";")[0] })).status === 401, "the pre-change refresh token must be revoked");
    const login = await post("/auth/login", { email, password: newPassword });
    const loginBody = await login.json();
    assert(loginBody.mustChangePassword === false, "flag must clear after the change");
    analystToken = loginBody.accessToken;
    const denied = await post(
      "/admin/staff",
      { email: `x${Date.now()}@dept.test`, fullName: "X", roleId: analyst.id },
      analystToken,
    );
    assert(denied.status === 403, `got ${denied.status}`);
  });
  // lockout is per (account, IP): needs the Next-server key to simulate a second IP (X-Visitor-Ip), so it only runs when the smoke has it
  const serverKey = process.env.STOREFRONT_SERVER_KEY;
  if (!serverKey) console.log("       (set STOREFRONT_SERVER_KEY, same as the API, to run the per-IP lockout check)");
  else {
    await check("failed logins lock only the (account, IP) pair: another IP cannot lock the owner out", async () => {
      const roles = await (await get("/admin/roles", token)).json();
      const analyst = (Array.isArray(roles) ? roles : roles.items).find((r) => r.key === "analyst");
      const email = `lock-${Date.now()}@dept.test`;
      const created = await post("/admin/staff", { email, fullName: "Smoke Lock", roleId: analyst.id }, token);
      const pass = (await created.json()).password;
      const attacker = { "x-storefront-key": serverKey, "x-visitor-ip": "203.0.113.77" };
      for (let i = 0; i < 6; i++) {
        const bad = await post("/auth/login", { email, password: "wrong-password-123" }, null, attacker);
        const b = await bad.json();
        assert(bad.status === 401 && b.code === "INVALID_CREDENTIALS", `attacker attempt ${i} → ${bad.status} ${b.code}`);
      }
      const attackerRight = await post("/auth/login", { email, password: pass }, null, attacker);
      assert(attackerRight.status === 401, `locked pair must refuse even the right password: ${attackerRight.status}`);
      const owner = await post("/auth/login", { email, password: pass }); // the usual IP of the account holder
      assert(owner.status < 300, `legitimate IP must still log in: ${owner.status}`);
    });
  }
  await check("2FA: setup reuses a recent pending secret; bad password on enable is refused; a recovery code regenerates the codes and disables 2FA", async () => {
    const { generate } = await import("otplib");
    const roles = await (await get("/admin/roles", token)).json();
    const analyst = (Array.isArray(roles) ? roles : roles.items).find((r) => r.key === "analyst");
    const email = `twofa-${Date.now()}@dept.test`;
    const temp = (await (await post("/admin/staff", { email, fullName: "Smoke 2FA", roleId: analyst.id }, token)).json()).password;
    const first = await (await post("/auth/login", { email, password: temp })).json();
    const password = `Smoke-${Date.now()}-Pass!`;
    const changed = await post("/auth/change-password", { current: temp, new: password }, first.accessToken);
    const session = await changed.json();
    assert(changed.status < 300 && session.accessToken, `change-password → ${changed.status}`);
    const at = session.accessToken;

    const s1 = await (await post("/auth/2fa/setup", {}, at)).json();
    const s2 = await (await post("/auth/2fa/setup", {}, at)).json();
    assert(s1.otpauthUrl?.startsWith("otpauth://") && s1.otpauthUrl === s2.otpauthUrl, "a second setup within 10 minutes must return the same secret/QR");
    const secret = new URL(s1.otpauthUrl).searchParams.get("secret");
    assert(secret, "otpauth URL without secret");

    const badPass = await post("/auth/2fa/enable", { password: "not-my-password-123", code: await generate({ secret }) }, at);
    assert(badPass.status === 401, `enable with a wrong password → ${badPass.status}`);
    const enabled = await post("/auth/2fa/enable", { password, code: await generate({ secret }) }, at);
    const enabledBody = await enabled.json();
    assert(enabled.status < 300 && enabledBody.recoveryCodes?.length === 8, `enable → ${enabled.status} ${JSON.stringify(enabledBody)}`);
    const [r1, r2] = enabledBody.recoveryCodes;

    // lost phone: a recovery code replaces the codes (it is consumed, the old set no longer works)
    const regen = await post("/auth/2fa/recovery-codes", { password, code: r1 }, at);
    const regenBody = await regen.json();
    assert(regen.status < 300 && regenBody.recoveryCodes?.length === 8 && !regenBody.recoveryCodes.includes(r2), `recovery-codes → ${regen.status} ${JSON.stringify(regenBody)}`);
    const stale = await post("/auth/2fa/recovery-codes", { password, code: r2 }, at);
    assert(stale.status === 400 && (await stale.json()).code === "INVALID_OTP", `a code from the replaced set must not work: ${stale.status}`);
    const reused = await post("/auth/2fa/recovery-codes", { password, code: r1 }, at);
    assert(reused.status === 400, `a consumed recovery code must not work twice: ${reused.status}`);

    const needs = await post("/auth/login", { email, password });
    assert(needs.status === 401 && (await needs.json()).code === "TWO_FACTOR_REQUIRED", "login must ask for the second factor");
    const disabled = await post("/auth/2fa/disable", { password, code: regenBody.recoveryCodes[0] }, at);
    assert(disabled.status < 300, `disable with a recovery code → ${disabled.status}`);
    const plain = await post("/auth/login", { email, password });
    assert(plain.status < 300, `login without 2FA after disabling → ${plain.status}`);
  });

  return { ownerToken: token, analystToken };
}
