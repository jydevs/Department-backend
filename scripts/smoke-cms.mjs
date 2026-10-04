// CMS flow: draft → preview → publish → schedule → restore, redirects and media upload.
export async function cmsChecks({ base, check, assert, ownerToken, analystToken }) {
  if (!ownerToken) return console.log("       (no owner token: CMS flow skipped)");
  const api = `${base}/api/v1`;
  const call = (method, path, body, token, headers = {}) =>
    fetch(`${api}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ok = async (res, what) => {
    assert(res.status < 300, `${what} → ${res.status} ${await res.clone().text()}`);
    return res.json();
  };
  const stamp = Date.now();
  const site = (name) => ({
    brand: { name },
    theme: { colors: { background: "#000000", foreground: "#ffffff", accent: "#d10000" }, fonts: { heading: "Anton", body: "Inter" } },
    seo: { titleTemplate: "%s — Daregular Dept.", defaultDescription: "Streetwear" },
    social: {},
    announcement: { enabled: false, text: "" },
    store: { currency: "COP", locale: "es-CO" },
  });

  let doc;
  await check("cms: section types are exposed with JSON schemas", async () => {
    const types = await ok(await call("GET", "/admin/content/section-types", undefined, ownerToken), "section-types");
    const list = Array.isArray(types) ? types : types.items;
    assert(list.some((t) => t.type === "hero" && t.settingsSchema), "hero missing");
  });

  await check("cms: saving settings creates a draft that is NOT public", async () => {
    const existing = await call("GET", "/admin/content/documents/settings/site", undefined, ownerToken);
    const version = existing.status === 200 ? (await existing.json()).version : undefined;
    doc = await ok(await call("PUT", "/admin/content/documents/settings/site", { data: site(`Draft ${stamp}`), ...(version !== undefined ? { version } : {}) }, ownerToken), "save draft");
    const pub = await fetch(`${api}/storefront/content/settings`);
    if (pub.status === 200) assert((await pub.json()).data.brand.name !== `Draft ${stamp}`, "draft leaked to public");
  });

  await check("cms: invalid template section → 400 with the path of the error", async () => {
    const r = await call("PUT", "/admin/content/documents/template/home", { data: { sections: [{ id: "hero-1", type: "hero", enabled: true, settings: { title: 123 } }] } }, ownerToken);
    const j = await r.json();
    assert(r.status === 400 && j.code === "VALIDATION_ERROR" && j.details?.some((d) => /settings/.test(d.path)), `status ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  });

  await check("cms: script-y URLs are rejected", async () => {
    const r = await call("PUT", "/admin/content/documents/menu/main", { data: { items: [{ id: "m1", label: "x", link: { type: "url", url: "javascript:alert(1)" } }] } }, ownerToken);
    assert(r.status === 400, `got ${r.status}`);
  });

  await check("cms: preview token shows the draft (no-store); bad token → 401", async () => {
    const tok = await ok(await call("POST", "/admin/content/preview-tokens", { kind: "settings", key: "site" }, ownerToken), "preview token");
    const r = await fetch(`${api}/storefront/content/settings?preview=${encodeURIComponent(tok.token)}`);
    assert(r.status === 200 && /no-store/.test(r.headers.get("cache-control") ?? ""), `preview ${r.status}`);
    assert((await r.json()).data.brand.name === `Draft ${stamp}`, "preview did not show the draft");
    const bad = await fetch(`${api}/storefront/content/settings?preview=nope`);
    assert(bad.status === 401, `bad token ${bad.status}`);
  });

  await check("cms: publish → public shows it, with ETag/304", async () => {
    await ok(await call("POST", "/admin/content/documents/settings/site/publish", {}, ownerToken), "publish");
    const r = await fetch(`${api}/storefront/content/settings`);
    assert(r.status === 200 && (await r.clone().json()).data.brand.name === `Draft ${stamp}`, "not published");
    const etag = r.headers.get("etag");
    assert(etag, "no etag");
    const again = await fetch(`${api}/storefront/content/settings`, { headers: { "if-none-match": etag } });
    assert(again.status === 304, `expected 304, got ${again.status}`);
    const twice = await call("POST", "/admin/content/documents/settings/site/publish", {}, ownerToken);
    assert(twice.status === 409, `publishing an unchanged draft should be 409, got ${twice.status}`);
  });

  await check("cms: publish/schedule honour an optional version (body or If-Match) → 409 CONCURRENT_UPDATE when stale", async () => {
    const cur = await ok(await call("GET", "/admin/content/documents/settings/site", undefined, ownerToken), "get");
    const saved = await ok(await call("PUT", "/admin/content/documents/settings/site", { data: site(`IfMatch ${stamp}`), version: cur.version }, ownerToken), "edit");
    assert(saved.version === cur.version + 1, `version ${saved.version}`);
    const staleBody = await call("POST", "/admin/content/documents/settings/site/publish", { version: cur.version }, ownerToken);
    assert(staleBody.status === 409 && (await staleBody.json()).code === "CONCURRENT_UPDATE", `stale body version → ${staleBody.status}`);
    const staleHeader = await call("POST", "/admin/content/documents/settings/site/publish", {}, ownerToken, { "if-match": String(cur.version) });
    assert(staleHeader.status === 409, `stale If-Match → ${staleHeader.status}`);
    const staleSchedule = await call("POST", "/admin/content/documents/settings/site/schedule", { publishAt: new Date(Date.now() + 3_600_000).toISOString(), version: cur.version }, ownerToken);
    assert(staleSchedule.status === 409 && (await staleSchedule.json()).code === "CONCURRENT_UPDATE", `stale schedule → ${staleSchedule.status}`);
    const pubStill = (await (await fetch(`${api}/storefront/content/settings`)).json()).data.brand.name;
    assert(pubStill === `Draft ${stamp}`, "a rejected publish must not publish");
    const good = await call("POST", "/admin/content/documents/settings/site/publish", {}, ownerToken, { "if-match": String(saved.version) });
    assert(good.status === 200, `matching If-Match → ${good.status} ${await good.clone().text()}`);
    const published = (await (await fetch(`${api}/storefront/content/settings`)).json()).data.brand.name;
    assert(published === `IfMatch ${stamp}`, `published "${published}"`);
  });

  await check("cms: scheduled publish is promoted by the scheduler", async () => {
    const cur = await ok(await call("GET", "/admin/content/documents/settings/site", undefined, ownerToken), "get");
    await ok(await call("PUT", "/admin/content/documents/settings/site", { data: site(`Scheduled ${stamp}`), version: cur.version }, ownerToken), "edit");
    await ok(await call("POST", "/admin/content/documents/settings/site/schedule", { publishAt: new Date(Date.now() + 2000).toISOString() }, ownerToken), "schedule");
    let name = "";
    for (let i = 0; i < 16 && name !== `Scheduled ${stamp}`; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      name = (await (await fetch(`${api}/storefront/content/settings`)).json()).data.brand.name;
    }
    assert(name === `Scheduled ${stamp}`, `still "${name}" after 48 s`);
  });

  await check("cms: restoring an old version fills the draft without publishing", async () => {
    const versions = await ok(await call("GET", "/admin/content/documents/settings/site/versions", undefined, ownerToken), "versions");
    const items = Array.isArray(versions) ? versions : versions.items;
    const old = items.find((v) => v.status === "superseded");
    assert(old, "no superseded version to restore");
    await ok(await call("POST", `/admin/content/documents/settings/site/versions/${old.id}/restore`, {}, ownerToken), "restore");
    const pub = (await (await fetch(`${api}/storefront/content/settings`)).json()).data.brand.name;
    assert(pub === `Scheduled ${stamp}`, "restore must not publish");
  });

  await check("cms: redirects are validated and listed publicly", async () => {
    const from = `/old-${stamp}`;
    await ok(await call("POST", "/admin/redirects", { fromPath: from, toPath: "/collections/all", statusCode: 301 }, ownerToken), "create redirect");
    const loop = await call("POST", "/admin/redirects", { fromPath: "/collections/all", toPath: from, statusCode: 301 }, ownerToken);
    assert(loop.status === 400, `redirect loop accepted: ${loop.status}`);
    const list = await (await fetch(`${api}/storefront/redirects`)).json();
    assert((Array.isArray(list) ? list : list.items).some((r) => (r.from ?? r.fromPath) === from), "not in public list");
  });

  await check("cms: analyst cannot publish (403)", async () => {
    if (!analystToken) return;
    const r = await call("POST", "/admin/content/documents/settings/site/publish", {}, analystToken);
    assert(r.status === 403, `got ${r.status}`);
  });

  await check("media: PNG upload is stored, served with nosniff; fake PNG → 415", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "pixel.png");
    const up = await fetch(`${api}/admin/media`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: form });
    assert(up.status < 300, `upload ${up.status} ${await up.clone().text()}`);
    const media = await up.json();
    const file = await fetch(media.url);
    assert(file.status === 200 && file.headers.get("x-content-type-options") === "nosniff" && file.headers.get("content-type") === "image/png", "served wrong");
    const fake = new FormData();
    fake.append("file", new Blob(["this is not an image"], { type: "image/png" }), "evil.png");
    const bad = await fetch(`${api}/admin/media`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: fake });
    assert(bad.status === 415, `fake png → ${bad.status}`);
    const traversal = await fetch(`${base}/media/..%2F..%2F.env`);
    assert(traversal.status === 404, `traversal → ${traversal.status}`);
  });
}
