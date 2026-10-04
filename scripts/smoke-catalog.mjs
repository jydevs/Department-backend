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

  await check("admin detail exposes each variant's `version`, and PATCH with it succeeds (no 409 probing)", async () => {
    const detail = await ok(await call("GET", `/admin/products/${product.id}`, undefined, ownerToken), "admin detail");
    const v = detail.variants[0];
    assert(Number.isInteger(v.version), `variant.version missing: ${JSON.stringify(v)}`);
    const patched = await ok(await call("PATCH", `/admin/products/${product.id}/variants/${v.id}`, { version: v.version, title: "Única v2" }, ownerToken), "patch variant");
    assert(patched.version === v.version + 1, `version not bumped: ${patched.version}`);
    const stale = await call("PATCH", `/admin/products/${product.id}/variants/${v.id}`, { version: v.version, title: "Única v3" }, ownerToken);
    assert(stale.status === 409, `stale version → ${stale.status}`);
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

  // ── Enriched storefront list items + manual collection members ──
  const t2 = `smoke-rich-${stamp}`;
  let rich;
  await check("storefront list items carry compareAtPrice, images, options and variants (no detail fetch needed)", async () => {
    const p = await ok(
      await call("POST", "/admin/products", { title: `Smoke Rich ${stamp}`, tags: [t2], options: [{ name: "Talla", values: [{ value: "S", position: 0 }, { value: "M", position: 1 }] }] }, ownerToken),
      "create product with options",
    );
    // creating a product with options generates one variant per value (price 0): give them a price/sku
    const gen = (title) => p.variants.find((v) => v.title === title);
    const vS = await ok(await call("PATCH", `/admin/products/${p.id}/variants/${gen("S").id}`, { version: gen("S").version, sku: `RICH-S-${stamp}`, price: 90000, compareAtPrice: 120000 }, ownerToken), "variant S");
    await ok(await call("PATCH", `/admin/products/${p.id}/variants/${gen("M").id}`, { version: gen("M").version, sku: `RICH-M-${stamp}`, price: 100000 }, ownerToken), "variant M");
    await ok(await call("PUT", `/admin/products/${p.id}/media`, { media: [{ url: "/media/a.png", alt: "A" }, { url: "/media/b.png", alt: "B" }, { url: "/media/c.png" }] }, ownerToken), "media");
    await ok(await call("POST", "/admin/inventory/adjust", { variantId: vS.id, locationId, delta: 3, reason: "received" }, ownerToken), "stock S");
    await ok(await call("POST", `/admin/products/${p.id}/publish`, {}, ownerToken), "publish");
    rich = p;

    const list = await ok(await fetch(`${api}/storefront/products?tag=${t2}`), "storefront list");
    const item = list.items.find((x) => x.handle === p.handle);
    assert(item, "product not in list");
    assert(item.price === 90000 && item.compareAtPrice === 120000, `price/compareAt ${item.price}/${item.compareAtPrice}`);
    assert(item.image?.url && item.images.length === 3 && item.images[0].url === item.image.url && item.images[1].alt === "B", `images ${JSON.stringify(item.images)}`);
    assert(item.options.length === 1 && item.options[0].name === "Talla" && item.options[0].values.join() === "S,M", `options ${JSON.stringify(item.options)}`);
    assert(item.variants.length === 2, `variants ${item.variants?.length}`);
    const vs = item.variants.find((v) => v.sku === `RICH-S-${stamp}`);
    assert(vs && vs.id === vS.id && vs.title === "S" && vs.price === 90000 && vs.compareAtPrice === 120000 && vs.available === true, `variant S ${JSON.stringify(vs)}`);
    assert(vs.values.length === 1 && vs.values[0].name === "Talla" && vs.values[0].value === "S", `values ${JSON.stringify(vs.values)}`);
    assert(item.variants.find((v) => v.title === "M").available === false, "M should be unavailable");
    assert(item.available === true, "product available");
    assert(!("version" in item.variants[0]), "internal field leaked");
  });

  await check("collection page and search items are enriched too", async () => {
    const hit = await ok(await fetch(`${api}/storefront/search?q=${encodeURIComponent(`Smoke Rich ${stamp}`)}`), "search");
    const sItem = hit.products.find((x) => x.handle === rich.handle);
    assert(sItem && sItem.variants.length === 2 && sItem.images.length === 3 && sItem.compareAtPrice === 120000, "search item not enriched");
  });

  let mcol;
  await check("manual collection members: add (idempotent), list all statuses, position, reorder, remove", async () => {
    const draft = await ok(await call("POST", "/admin/products", { title: `Smoke Member Draft ${stamp}`, tags: [t2], variants: [{ title: "U", price: 1000 }] }, ownerToken), "draft product");
    mcol = await ok(await call("POST", "/admin/collections", { handle: `smoke-man-${stamp}`, title: "Manual", type: "manual", isPublished: true }, ownerToken), "manual collection");
    const base2 = `/admin/collections/${mcol.id}/products`;
    const a1 = await ok(await call("POST", base2, { productIds: [rich.id, draft.id] }, ownerToken), "add");
    assert(a1.added.length === 2 && a1.total === 2, JSON.stringify(a1));
    const a2 = await ok(await call("POST", base2, { productIds: [rich.id] }, ownerToken), "add again");
    assert(a2.added.length === 0 && a2.alreadyMembers.length === 1 && a2.total === 2, `not idempotent ${JSON.stringify(a2)}`);
    const third = await ok(await call("POST", "/admin/products", { title: `Smoke Member 3 ${stamp}`, variants: [{ title: "U", price: 1000 }] }, ownerToken), "third product");
    await ok(await call("POST", base2, { productIds: [third.id], position: 0 }, ownerToken), "add at 0");
    const list = await ok(await call("GET", `${base2}?pageSize=2`, undefined, ownerToken), "list");
    assert(list.total === 3 && list.items.length === 2 && list.totalPages === 2, JSON.stringify({ t: list.total, n: list.items.length }));
    assert(list.items[0].id === third.id && list.items[0].position === 0 && list.items[0].status === "draft", "position 0 / draft status missing");
    assert(list.items[1].id === rich.id && list.items[1].image?.url, "second item or image");
    const reo = await call("PATCH", `${base2}/reorder`, { productId: third.id, position: 99 }, ownerToken);
    assert(reo.status === 204, `reorder → ${reo.status}`);
    const after = await ok(await call("GET", base2, undefined, ownerToken), "list after reorder");
    assert(after.items.map((i) => i.id).join() === [rich.id, draft.id, third.id].join(), "reorder result wrong");
    const del = await call("DELETE", `${base2}/${draft.id}`, undefined, ownerToken);
    assert(del.status === 204, `delete → ${del.status}`);
    const del2 = await call("DELETE", `${base2}/${draft.id}`, undefined, ownerToken);
    assert(del2.status === 204, `second delete (idempotent) → ${del2.status}`);
    const final = await ok(await call("GET", base2, undefined, ownerToken), "list final");
    assert(final.total === 2 && final.items.map((i) => i.position).join() === "0,1", `positions ${JSON.stringify(final.items.map((i) => i.position))}`);
    const missing = await call("POST", base2, { productIds: ["00000000-0000-4000-8000-000000000000"] }, ownerToken);
    assert(missing.status === 400 && (await missing.json()).code === "PRODUCTS_NOT_FOUND", `unknown product → ${missing.status}`);
    // the storefront only shows the active member
    const page = await ok(await fetch(`${api}/storefront/collections/${mcol.handle}`), "storefront manual collection");
    assert(page.products.items.length === 1 && page.products.items[0].handle === rich.handle, "storefront should list only the active member");
  });

  await check("smart collections reject member add/remove/reorder with 409 COLLECTION_NOT_MANUAL; analyst: read-only 403 on write", async () => {
    const smart = await ok(
      await call("POST", "/admin/collections", { handle: `smoke-smart-${stamp}`, title: "S", type: "smart", isPublished: false, rules: { match: "all", conditions: [{ field: "tag", op: "eq", value: t2 }] } }, ownerToken),
      "smart",
    );
    const b = `/admin/collections/${smart.id}/products`;
    for (const [method, path, body] of [["POST", b, { productIds: [rich.id] }], ["DELETE", `${b}/${rich.id}`], ["PATCH", `${b}/reorder`, { productId: rich.id, position: 0 }]]) {
      const r = await call(method, path, body, ownerToken);
      const j = await r.json();
      assert(r.status === 409 && j.code === "COLLECTION_NOT_MANUAL", `${method} → ${r.status} ${j.code}`);
    }
    if (analystToken) {
      const read = await call("GET", `/admin/collections/${mcol.id}/products`, undefined, analystToken);
      const write = await call("POST", `/admin/collections/${mcol.id}/products`, { productIds: [rich.id] }, analystToken);
      assert(read.status === 200 && write.status === 403, `analyst read ${read.status} write ${write.status}`);
    }
    const none = await call("GET", "/admin/collections/00000000-0000-4000-8000-000000000000/products", undefined, ownerToken);
    assert(none.status === 404, `unknown collection → ${none.status}`);
  });
}
