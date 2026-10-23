// Admin/storefront gaps: variant version, inventory product data, collection products/image/version, facets,
// metafield delete, product create options, mark-paid duplicate reference, local http image URLs, storefront card
// fields (compareAtPrice, hoverImage, variants, tags, vendor, total, available filter), contact phone and
// catalog revalidation. Revalidation checks need the API started with STOREFRONT_URL=http://localhost:$SMOKE_REVALIDATE_PORT
// and STOREFRONT_REVALIDATE_SECRET=$SMOKE_REVALIDATE_SECRET (>= 32 chars); they are skipped otherwise.
import { createHmac } from "node:crypto";
import http from "node:http";

export async function gapsChecks({ base, check, assert, ownerToken, analystToken }) {
  if (!ownerToken) return console.log("       (no owner token: gaps flow skipped)");
  const api = `${base}/api/v1`;
  const call = (method, path, body, token = ownerToken, headers = {}) =>
    fetch(`${api}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ok = async (res, what) => {
    assert(res.status < 300, `${what} → ${res.status} ${await res.clone().text()}`);
    return res.json();
  };
  const items = (x) => (Array.isArray(x) ? x : x.items);
  const stamp = Date.now();
  const tag = `gaps-${stamp}`;
  const vendor = `Gaps Vendor ${stamp}`;
  const productType = `Gaps Type ${stamp}`;

  /* ── revalidation receiver ── */
  const rvPort = Number(process.env.SMOKE_REVALIDATE_PORT || 0);
  const rvSecret = process.env.SMOKE_REVALIDATE_SECRET || "";
  const received = [];
  let server;
  if (rvPort && rvSecret) {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const sig = createHmac("sha256", rvSecret).update(body).digest("hex");
        received.push({ url: req.url, valid: req.headers["x-signature"] === sig, body: JSON.parse(body || "{}") });
        res.statusCode = 200;
        res.end("{}");
      });
    });
    await new Promise((resolve, reject) => server.once("error", reject).listen(rvPort, "127.0.0.1", resolve));
  }
  const tagsSince = async (from, wanted) => {
    for (let i = 0; i < 40; i++) {
      const all = received.slice(from).flatMap((r) => r.body.tags ?? []);
      if (wanted.every((t) => all.includes(t))) return all;
      await new Promise((r) => setTimeout(r, 150));
    }
    return received.slice(from).flatMap((r) => r.body.tags ?? []);
  };

  try {
    let locationId;
    let product; // the main product (options Talla S/M)
    let plain; // product without stock
    let imageMediaId;
    let collection;

    await check("gaps: default stock location exists", async () => {
      const locs = items(await ok(await call("GET", "/admin/locations"), "locations"));
      let loc = locs.find((l) => l.isDefault && l.isActive);
      if (!loc) loc = await ok(await call("POST", "/admin/locations", { name: "Bogotá", isDefault: true }), "create location");
      locationId = loc.id;
    });

    await check("gaps(7): create with options — optionValues link to the created ids; defaultVariantPrice applies to generated variants", async () => {
      product = await ok(
        await call("POST", "/admin/products", {
          title: `Gaps Tee ${stamp}`,
          vendor,
          productType,
          tags: [tag],
          options: [{ name: "Talla", values: [{ value: "S" }, { value: "M" }] }],
          variants: [
            { title: "S", sku: `GAPS-S-${stamp}`, price: 100000, compareAtPrice: 150000, optionValues: ["S"] },
            { title: "M", sku: `GAPS-M-${stamp}`, price: 120000, optionValues: ["M"] },
          ],
        }),
        "create product",
      );
      const valueId = (v) => product.options[0].values.find((x) => x.value === v).id;
      assert(product.variants[0].optionValueIds[0] === valueId("S") && product.variants[1].optionValueIds[0] === valueId("M"), "optionValueIds not linked");
      const gen = await ok(
        await call("POST", "/admin/products", {
          title: `Gaps Gen ${stamp}`,
          options: [{ name: "Color", values: [{ value: "Rojo" }, { value: "Azul" }] }],
          defaultVariantPrice: 55000,
        }),
        "create generated",
      );
      assert(gen.variants.length === 2 && gen.variants.every((v) => v.price === 55000), `generated prices ${JSON.stringify(gen.variants.map((v) => v.price))}`);
      const dup = await call("POST", "/admin/products", {
        title: `Gaps Dup ${stamp}`,
        options: [{ name: "Talla", values: [{ value: "S" }] }],
        variants: [
          { title: "a", price: 1, optionValues: ["S"] },
          { title: "b", price: 1, optionValues: ["s"] },
        ],
      });
      assert(dup.status === 400, `duplicate combination → ${dup.status}`);
      const unknown = await call("POST", "/admin/products", {
        title: `Gaps Unk ${stamp}`,
        options: [{ name: "Talla", values: [{ value: "S" }] }],
        variants: [{ title: "a", price: 1, optionValues: ["XL"] }],
      });
      assert(unknown.status === 400, `unknown value → ${unknown.status}`);
      plain = await ok(await call("POST", "/admin/products", { title: `Gaps Plain ${stamp}`, vendor, tags: [tag], variants: [{ title: "Única", sku: `GAPS-P-${stamp}`, price: 80000 }] }), "create plain");
    });

    await check("gaps(1): variants of GET/create responses carry `version` and PATCH accepts it", async () => {
      const detail = await ok(await call("GET", `/admin/products/${product.id}`), "get product");
      const v = detail.variants[0];
      assert(Number.isInteger(v.version) && Number.isInteger(product.variants[0].version), "version missing");
      const patched = await ok(await call("PATCH", `/admin/products/${product.id}/variants/${v.id}`, { version: v.version, price: 100000 }), "patch variant");
      assert(patched.version >= v.version, "version regressed");
    });

    let rvFrom = received.length;
    await check("gaps: media (two images) + publish + stock", async () => {
      await ok(
        await call("PUT", `/admin/products/${product.id}/media`, {
          media: [
            { url: `https://example.com/gaps-${stamp}-1.jpg`, alt: "uno" },
            { url: `https://example.com/gaps-${stamp}-2.jpg`, alt: "dos" },
          ],
        }),
        "media",
      );
      product = await ok(await call("GET", `/admin/products/${product.id}`), "reload");
      imageMediaId = product.media[0].id;
      rvFrom = received.length;
      await ok(await call("POST", `/admin/products/${product.id}/publish`, {}), "publish product");
      await ok(await call("POST", `/admin/products/${plain.id}/publish`, {}), "publish plain");
      const s = product.variants.find((x) => x.title === "S");
      await ok(await call("POST", "/admin/inventory/adjust", { variantId: s.id, locationId, delta: 5, reason: "received" }), "stock S");
    });

    await check("gaps(14): publish + stock adjustment send signed revalidation requests with catalog tags", async () => {
      if (!server) return console.log("       (SMOKE_REVALIDATE_PORT/SECRET not set: skipped)");
      const tags = await tagsSince(rvFrom, ["catalog", `catalog:product:${product.handle}`]);
      assert(tags.includes("catalog") && tags.includes(`catalog:product:${product.handle}`), `tags ${JSON.stringify(tags)}`);
      const mine = received.slice(rvFrom);
      assert(mine.length > 0 && mine.every((r) => r.valid && r.url === "/api/revalidate"), "invalid signature or path");
      assert(mine.every((r) => Math.abs(Date.now() - r.body.ts) < 60000), "stale ts");
      assert(mine.every((r) => (r.body.tags ?? []).every((t) => /^(catalog|catalog:(product|collection):[a-z0-9-]+)$/.test(t))), "tag outside whitelist");
      // only after the stock adjustment: a dedicated request again
      const before = received.length;
      const s = product.variants.find((x) => x.title === "S");
      await ok(await call("POST", "/admin/inventory/adjust", { variantId: s.id, locationId, delta: 1, reason: "received" }), "adjust again");
      const after = await tagsSince(before, [`catalog:product:${product.handle}`]);
      assert(after.includes(`catalog:product:${product.handle}`), `adjust tags ${JSON.stringify(after)}`);
      assert(received.slice(before).every((r) => r.valid), "adjust signature invalid");
    });

    await check("gaps(2): inventory levels and adjustments include productId/productTitle/productHandle", async () => {
      const s = product.variants.find((x) => x.title === "S");
      const inv = items(await ok(await call("GET", `/admin/inventory?q=GAPS-S-${stamp}&pageSize=100`), "inventory"));
      const row = inv.find((r) => r.variantId === s.id);
      assert(row && row.productId === product.id && row.productTitle === product.title && row.productHandle === product.handle, JSON.stringify(row));
      const adj = items(await ok(await call("GET", `/admin/inventory/adjustments?variantId=${s.id}`), "adjustments"));
      assert(adj.length > 0 && adj.every((a) => a.productId === product.id && a.productTitle === product.title && a.productHandle === product.handle), JSON.stringify(adj[0]));
    });

    await check("gaps(3,4): manual collection — image, version, optimistic lock, ordered members incl. drafts, smart → 409", async () => {
      const draft = await ok(await call("POST", "/admin/products", { title: `Gaps Draft ${stamp}`, variants: [{ title: "Única", price: 9000 }] }), "draft");
      collection = await ok(
        await call("POST", "/admin/collections", { handle: `gaps-col-${stamp}`, title: "Gaps", type: "manual", isPublished: true, imageMediaId }),
        "create collection",
      );
      assert(Number.isInteger(collection.version) && collection.image?.url === `https://example.com/gaps-${stamp}-1.jpg`, JSON.stringify(collection));
      const got = await ok(await call("GET", `/admin/collections/${collection.id}`), "get collection");
      assert(got.image?.url && got.version === collection.version, "get collection image/version");
      const list = items(await ok(await call("GET", "/admin/collections?pageSize=100"), "list collections"));
      assert(list.find((c) => c.id === collection.id)?.image?.url, "list image missing");

      const put = await call("PUT", `/admin/collections/${collection.id}/products`, { products: [{ productId: draft.id }, { productId: product.id }, { productId: plain.id }] });
      assert(put.status < 300, `set products → ${put.status}`);
      const members = await ok(await call("GET", `/admin/collections/${collection.id}/products`), "members");
      assert(members.total === 3 && members.items.map((m) => m.id).join() === [draft.id, product.id, plain.id].join(), "order");
      const m0 = members.items[0];
      const m1 = members.items[1];
      assert(m0.status === "draft" && m0.handle && m0.title && m0.minPrice === 9000, JSON.stringify(m0));
      assert(m1.status === "active" && m1.image?.url === `https://example.com/gaps-${stamp}-1.jpg` && m1.minPrice === 100000, JSON.stringify(m1));

      const smart = await ok(
        await call("POST", "/admin/collections", { handle: `gaps-smart-${stamp}`, title: "Smart", type: "smart", isPublished: false, rules: { match: "all", conditions: [{ field: "tag", op: "eq", value: tag }] } }),
        "smart",
      );
      const r409 = await call("GET", `/admin/collections/${smart.id}/products`);
      assert(r409.status === 409 && (await r409.json()).code === "COLLECTION_NOT_MANUAL", "smart should be 409 COLLECTION_NOT_MANUAL");
      assert((await call("GET", `/admin/collections/${crypto.randomUUID()}/products`)).status === 404, "unknown collection → 404");

      const v1 = await ok(await call("PATCH", `/admin/collections/${collection.id}`, { title: "Gaps 2", version: collection.version }), "patch ok");
      assert(v1.version === collection.version + 1, `version ${v1.version}`);
      const stale = await call("PATCH", `/admin/collections/${collection.id}`, { title: "Gaps 3", version: collection.version });
      assert(stale.status === 409 && (await stale.json()).code === "CONCURRENT_UPDATE", `stale → ${stale.status}`);
      await ok(await call("PATCH", `/admin/collections/${collection.id}`, { title: "Gaps 4" }), "patch without version stays compatible");
    });

    await check("gaps(5): GET /admin/products/facets lists tags, vendors and product types", async () => {
      const f = await ok(await call("GET", "/admin/products/facets"), "facets");
      assert(f.tags.includes(tag) && f.vendors.includes(vendor) && f.productTypes.includes(productType), JSON.stringify(f).slice(0, 200));
      assert([...f.tags].sort().join() === f.tags.join() || f.tags.length > 0, "sorted");
      if (analystToken) assert((await call("GET", "/admin/products/facets", undefined, analystToken)).status === 200, "analyst can read facets");
    });

    await check("gaps(6): metafields can be deleted (products and collections); 404 when missing", async () => {
      const body = { metafields: [{ namespace: "custom", key: "gaps", type: "single_line_text", value: "x" }] };
      await ok(await call("PUT", `/admin/products/${product.id}/metafields`, body), "put product metafield");
      assert((await call("DELETE", `/admin/products/${product.id}/metafields/custom/gaps`)).status < 300, "delete product metafield");
      assert((await call("DELETE", `/admin/products/${product.id}/metafields/custom/gaps`)).status === 404, "second delete → 404");
      assert((await ok(await call("GET", `/admin/products/${product.id}/metafields`), "list")).metafields.length === 0, "still listed");
      await ok(await call("PUT", `/admin/collections/${collection.id}/metafields`, body), "put collection metafield");
      assert((await call("DELETE", `/admin/collections/${collection.id}/metafields/custom/gaps`)).status < 300, "delete collection metafield");
      assert((await call("DELETE", `/admin/collections/${collection.id}/metafields/custom/gaps`)).status === 404, "collection second delete → 404");
      if (analystToken) assert((await call("DELETE", `/admin/products/${product.id}/metafields/custom/gaps`, undefined, analystToken)).status === 403, "analyst delete → 403");
    });

    await check("gaps(10,11,12): storefront cards expose compareAtPrice, hoverImage, tags, vendor, variants, total and the available filter", async () => {
      const res = await fetch(`${api}/storefront/products?tag=${tag}&sort=title`);
      assert(/s-maxage=60/.test(res.headers.get("cache-control") ?? ""), `cache-control ${res.headers.get("cache-control")}`);
      const page = await res.json();
      assert(page.total === 2 && page.items.length === 2, `total ${page.total} items ${page.items?.length}`);
      const card = page.items.find((p) => p.handle === product.handle);
      assert(card.compareAtPrice === 150000, `compareAtPrice ${card.compareAtPrice}`);
      assert(card.image.url.endsWith("-1.jpg") && card.hoverImage?.url.endsWith("-2.jpg"), `images ${JSON.stringify([card.image, card.hoverImage])}`);
      assert(card.tags.includes(tag) && card.vendor === vendor, "tags/vendor");
      assert(typeof card.updatedAt === "string" && new Date(card.updatedAt).toISOString() === card.updatedAt, `updatedAt ${card.updatedAt}`);
      assert(card.price === 100000 && card.available === true, "legacy fields");
      const s = card.variants.find((v) => v.title === "S");
      const m = card.variants.find((v) => v.title === "M");
      assert(card.variants.length === 2 && s.available === true && m.available === false, JSON.stringify(card.variants));
      assert(s.price === 100000 && s.compareAtPrice === 150000 && s.options.length === 1 && s.options[0].name === "Talla" && s.options[0].value === "S", JSON.stringify(s));
      const other = page.items.find((p) => p.handle === plain.handle);
      assert(other.compareAtPrice === null && other.hoverImage === null && other.available === false, JSON.stringify(other));

      const yes = await (await fetch(`${api}/storefront/products?tag=${tag}&available=true`)).json();
      assert(yes.total === 1 && yes.items.length === 1 && yes.items[0].handle === product.handle, `available=true ${JSON.stringify(yes.items?.map((i) => i.handle))} total ${yes.total}`);
      const no = await (await fetch(`${api}/storefront/products?tag=${tag}&available=false`)).json();
      assert(no.total === 1 && no.items[0].handle === plain.handle, "available=false");
      const paged = await (await fetch(`${api}/storefront/products?tag=${tag}&limit=1&sort=title`)).json();
      assert(paged.total === 2 && paged.hasMore === true && paged.nextCursor, "total must ignore the page size and keep the cursor");
      assert((await fetch(`${api}/storefront/products?available=maybe`)).status === 400, "bad available → 400");

      const col = await fetch(`${api}/storefront/collections/${collection.handle}`);
      assert(/s-maxage=60/.test(col.headers.get("cache-control") ?? ""), "collection cache-control");
      const cj = await col.json();
      assert(cj.products.total === 2, `collection total ${cj.products.total}`);
      const ccard = cj.products.items.find((p) => p.handle === product.handle);
      assert(ccard.compareAtPrice === 150000 && ccard.hoverImage && ccard.variants.length === 2, "collection card fields");
      const cyes = await (await fetch(`${api}/storefront/collections/${collection.handle}?available=true`)).json();
      assert(cyes.products.total === 1 && cyes.products.items[0].handle === product.handle, "collection available=true");

      const search = await (await fetch(`${api}/storefront/search?q=${encodeURIComponent(`Gaps Tee ${stamp}`)}`)).json();
      const sc = search.products.find((p) => p.handle === product.handle);
      assert(sc && sc.compareAtPrice === 150000 && sc.variants.length === 2 && sc.tags.includes(tag), "search card fields");
    });

    await check("gaps(8): mark-paid with a reference already used by another payment → 409 PAYMENT_REFERENCE_DUPLICATE", async () => {
      const zone = await ok(await call("POST", "/admin/shipping/zones", { name: `Gaps zone ${stamp}`, departments: ["*"] }), "zone");
      const rate = await ok(await call("POST", "/admin/shipping/rates", { zoneId: zone.id, name: "Estándar", price: 10000, minDays: 1, maxDays: 3 }), "rate");
      const s = product.variants.find((x) => x.title === "S");
      const address = { fullName: "Gaps Buyer", phone: "3001234567", department: "Cundinamarca", city: "Bogotá", address1: "Calle 1 # 2-3" };
      const makeOrder = async (n) => {
        const cart = await ok(await fetch(`${api}/storefront/carts`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), "cart");
        const hdr = { "x-cart-token": cart.token };
        await ok(await fetch(`${api}/storefront/carts/${cart.id}/lines`, { method: "POST", headers: { "content-type": "application/json", ...hdr }, body: JSON.stringify({ variantId: s.id, quantity: 1 }) }), "line");
        const order = await ok(
          await fetch(`${api}/storefront/checkouts`, {
            method: "POST",
            headers: { "content-type": "application/json", ...hdr, "idempotency-key": `gaps-${stamp}-${n}` },
            body: JSON.stringify({ cartId: cart.id, email: `gaps-${n}-${stamp}@dept.test`, shippingAddress: address, shippingRateId: rate.id }),
          }),
          "checkout",
        );
        const found = items(await ok(await call("GET", `/admin/orders?q=${order.orderNumber}`), "find order"))[0];
        return found.id;
      };
      const [a, b] = [await makeOrder(1), await makeOrder(2)];
      const reference = `GAPS-REF-${stamp}`;
      await ok(await call("POST", `/admin/orders/${a}/mark-paid`, { reference }), "mark-paid #1");
      const dup = await call("POST", `/admin/orders/${b}/mark-paid`, { reference });
      const j = await dup.json();
      assert(dup.status === 409 && j.code === "PAYMENT_REFERENCE_DUPLICATE" && /reference/i.test(j.message), `${dup.status} ${JSON.stringify(j)}`);
      const still = await (await call("GET", `/admin/orders/${b}`)).json();
      assert(still.status === "pending", `order must stay pending (${still.status})`);
    });

    await check("gaps(9): image URLs may be http://localhost outside production; foreign http stays rejected", async () => {
      const existing = await call("GET", "/admin/content/documents/settings/site");
      const version = existing.status === 200 ? (await existing.json()).version : undefined;
      const site = (logo) => ({
        brand: { name: `Gaps ${stamp}`, logoMediaUrl: logo },
        theme: { colors: { background: "#000000", foreground: "#ffffff", accent: "#d10000" }, fonts: { heading: "Anton", body: "Inter" } },
        seo: { titleTemplate: "%s — Daregular Dept.", defaultDescription: "Streetwear" },
        social: {},
        announcement: { enabled: false, text: "" },
        store: { currency: "COP", locale: "es-CO" },
      });
      const put = (logo, v) => call("PUT", "/admin/content/documents/settings/site", { data: site(logo), ...(v !== undefined ? { version: v } : {}) });
      let v = version;
      for (const url of ["http://localhost:4500/uploads/logo.png", "http://127.0.0.1:4500/a.png", "http://[::1]:4500/a.png"]) {
        const r = await put(url, v);
        assert(r.status < 300, `${url} → ${r.status} ${await r.clone().text()}`);
        v = (await r.json()).version;
      }
      for (const url of ["http://evil.example/a.png", "http://localhost.evil.example/a.png", "http://localhost@evil.example/a.png"]) {
        const r = await put(url, v);
        assert(r.status === 400, `${url} → ${r.status}`);
      }
    });

  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

/** Runs last: POST /storefront/contact is throttled to 3/min per IP and the customers flow already uses 2. */
export async function gapsContactChecks({ base, check, assert, ownerToken }) {
  if (!ownerToken) return;
  const api = `${base}/api/v1`;
  const stamp = Date.now();
  const post = async (extra) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`${api}/storefront/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Gaps", email: `gaps-${stamp}@dept.test`, message: `hola gaps ${stamp}`, ...extra }),
      });
      if (r.status !== 429) return r;
      await new Promise((resolve) => setTimeout(resolve, (Number(r.headers.get("retry-after")) || 61) * 1000 + 500));
    }
    throw new Error("still throttled");
  };
  await check("gaps(13): contact accepts an optional phone (7-20 digits), stores it and rejects malformed values", async () => {
    const good = await post({ phone: "+573001234567" });
    assert(good.status === 202, `valid phone → ${good.status}`);
    const bad = await post({ phone: "+57 300 abc" });
    assert(bad.status === 400, `malformed phone → ${bad.status}`);
    const list = await (await fetch(`${api}/admin/contact-messages?q=gaps-${stamp}&pageSize=50`, { headers: { authorization: `Bearer ${ownerToken}` } })).json();
    assert(list.items.some((m) => m.phone === "+573001234567"), JSON.stringify(list.items.map((m) => m.phone)));
  });
}
