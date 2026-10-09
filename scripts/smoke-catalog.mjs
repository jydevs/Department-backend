// Catalog + inventory flow. Needs the tokens returned by identityChecks (owner + analyst).
export async function catalogChecks({ base, check, assert, ownerToken, analystToken }) {
  if (!ownerToken) return console.log("       (no owner token: catalog flow skipped)");
  const api = `${base}/api/v1`;
  const call = (method, path, body, token) =>
    fetch(`${api}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ok = async (res, what) => {
    assert(res.status < 300, `${what} → ${res.status} ${await res.clone().text()}`);
    return res.json();
  };

  const stamp = Date.now();
  const tag = `smoke-${stamp}`;
  let locationId;
  let product;
  let variant;

  await check("a default stock location exists (created if missing)", async () => {
    const list = await ok(await call("GET", "/admin/locations", undefined, ownerToken), "list locations");
    const items = Array.isArray(list) ? list : list.items;
    let loc = items.find((l) => l.isDefault && l.isActive);
    if (!loc) loc = await ok(await call("POST", "/admin/locations", { name: "Bogotá", isDefault: true }, ownerToken), "create location");
    locationId = loc.id;
    assert(locationId, "no location id");
  });

  await check("owner creates a draft product with a variant", async () => {
    product = await ok(
      await call(
        "POST",
        "/admin/products",
        { title: `Smoke Hoodie ${stamp}`, tags: [tag], variants: [{ title: "Única", sku: `SMOKE-${stamp}`, price: 189000 }] },
        ownerToken,
      ),
      "create product",
    );
    variant = product.variants[0];
    assert(product.status === "draft" && variant?.id, "expected a draft product with one variant");
  });

  await check("a draft product is NOT visible in the storefront", async () => {
    const r = await fetch(`${api}/storefront/products/${product.handle}`);
    assert(r.status === 404, `got ${r.status}`);
  });

  await check("duplicate SKU → 409 SKU_TAKEN", async () => {
    const r = await call("POST", `/admin/products/${product.id}/variants`, { title: "Otra", sku: `SMOKE-${stamp}`, price: 1000 }, ownerToken);
    assert(r.status === 409 && (await r.json()).code === "SKU_TAKEN", `got ${r.status}`);
  });

  await check("publish → visible in storefront list and by handle, out of stock", async () => {
    await ok(await call("POST", `/admin/products/${product.id}/publish`, {}, ownerToken), "publish");
    const list = await (await fetch(`${api}/storefront/products?tag=${tag}`)).json();
    assert(list.items?.some((p) => p.handle === product.handle), "not in storefront list");
    const detail = await ok(await fetch(`${api}/storefront/products/${product.handle}`), "storefront detail");
    assert(detail.variants[0].available === false, "should be unavailable without stock");
    assert(!("version" in detail) && !("deletedAt" in detail), "internal fields leaked");
  });

  await check("adjusting stock flips `available` and rejects negative stock", async () => {
    await ok(await call("POST", "/admin/inventory/adjust", { variantId: variant.id, locationId, delta: 5, reason: "received" }, ownerToken), "adjust");
    const detail = await (await fetch(`${api}/storefront/products/${product.handle}`)).json();
    assert(detail.variants[0].available === true, "still unavailable after receiving stock");
    const bad = await call("POST", "/admin/inventory/adjust", { variantId: variant.id, locationId, delta: -99, reason: "correction" }, ownerToken);
    assert(bad.status === 409, `negative stock accepted: ${bad.status}`);
  });

  await check("smart collection by tag includes the product", async () => {
    const col = await ok(
      await call(
        "POST",
        "/admin/collections",
        { handle: `smoke-col-${stamp}`, title: "Smoke", type: "smart", isPublished: true, rules: { match: "all", conditions: [{ field: "tag", op: "eq", value: tag }] } },
        ownerToken,
      ),
      "create collection",
    );
    const page = await ok(await fetch(`${api}/storefront/collections/${col.handle}`), "storefront collection");
    const items = page.products?.items ?? page.items ?? [];
    assert(items.some((p) => p.handle === product.handle), "product missing from smart collection");
  });

  await check("search finds the product; a bare % does not match everything", async () => {
    const hit = await (await fetch(`${api}/storefront/search?q=${encodeURIComponent(`Smoke Hoodie ${stamp}`)}`)).json();
    assert(hit.products?.some((p) => p.handle === product.handle), "search miss");
    const wild = await fetch(`${api}/storefront/search?q=%25%25`);
    assert(wild.status === 400 || (await wild.json()).products?.length === 0, "wildcard matched everything");
  });

  await check("malformed uuid → 400 (not 500)", async () => {
    const r = await call("GET", "/admin/products/not-a-uuid", undefined, ownerToken);
    assert(r.status === 400, `got ${r.status}`);
  });

  await check("analyst cannot write products or inventory (403)", async () => {
    if (!analystToken) return console.log("       (no analyst token)");
    const p = await call("POST", "/admin/products", { title: "nope" }, analystToken);
    const i = await call("POST", "/admin/inventory/adjust", { variantId: variant.id, locationId, delta: 1, reason: "received" }, analystToken);
    assert(p.status === 403 && i.status === 403, `products ${p.status}, inventory ${i.status}`);
  });

  await check("archive removes the product from the storefront", async () => {
    await ok(await call("POST", `/admin/products/${product.id}/archive`, {}, ownerToken), "archive");
    const r = await fetch(`${api}/storefront/products/${product.handle}`);
    assert(r.status === 404, `got ${r.status}`);
  });
}
