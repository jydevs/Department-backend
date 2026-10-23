// Commerce flow: cart → quote → idempotent checkout → mock payment webhook → fulfillment → refund → cancel/late approval → discount race.
export async function commerceChecks({ base, check, assert, ownerToken, analystToken }) {
  if (!ownerToken) return console.log("       (no owner token: commerce flow skipped)");
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
  const PRICE = 100000;
  const address = { fullName: "Smoke Buyer", phone: "3001234567", department: "Cundinamarca", city: "Bogotá", address1: "Calle 1 # 2-3" };
  const items = (x) => (Array.isArray(x) ? x : x.items);

  let variantId, locationId, rateId, handle;

  const newProduct = async (title, stock) => {
    const p = await ok(await call("POST", "/admin/products", { title, tags: [`smoke-c-${stamp}`], variants: [{ title: "Única", sku: `SC-${stamp}-${Math.random().toString(36).slice(2, 7)}`, price: PRICE }] }, ownerToken), "create product");
    await ok(await call("POST", `/admin/products/${p.id}/publish`, {}, ownerToken), "publish");
    await ok(await call("POST", "/admin/inventory/adjust", { variantId: p.variants[0].id, locationId, delta: stock, reason: "received" }, ownerToken), "stock");
    return { id: p.id, handle: p.handle, variantId: p.variants[0].id };
  };
  const available = async (h) => (await (await fetch(`${api}/storefront/products/${h}`)).json()).variants[0].available;
  const newCart = async () => {
    const c = await ok(await call("POST", "/storefront/carts", {}), "create cart");
    return { id: c.id, hdr: { "x-cart-token": c.token } };
  };
  const addLine = (cart, vId, quantity) => call("POST", `/storefront/carts/${cart.id}/lines`, { variantId: vId, quantity }, undefined, cart.hdr);
  const checkoutBody = (cart, extra = {}) => ({ cartId: cart.id, email: `buyer-${stamp}@dept.test`, shippingAddress: address, shippingRateId: rateId, ...extra });
  const doCheckout = (cart, key, extra) => call("POST", "/storefront/checkouts", checkoutBody(cart, extra), undefined, { ...cart.hdr, "idempotency-key": key });
  const orderIdByNumber = async (n) => items(await (await call("GET", `/admin/orders?q=${n}`, undefined, ownerToken)).json())[0].id;
  const adminOrder = async (id) => (await call("GET", `/admin/orders/${id}`, undefined, ownerToken)).json();
  const mockPay = (reference, status) => call("POST", "/storefront/dev/mock-payment", { reference, status });

  await check("commerce: setup (location, product with 2 units, shipping zone/rate, discount)", async () => {
    const locs = items(await (await call("GET", "/admin/locations", undefined, ownerToken)).json());
    let loc = locs.find((l) => l.isDefault && l.isActive);
    if (!loc) loc = await ok(await call("POST", "/admin/locations", { name: "Bogotá", isDefault: true }, ownerToken), "location");
    locationId = loc.id;
    const prod = await newProduct(`Smoke Buy ${stamp}`, 2);
    variantId = prod.variantId;
    handle = prod.handle;
    const zone = await ok(await call("POST", "/admin/shipping/zones", { name: `Smoke zone ${stamp}`, departments: ["*"] }, ownerToken), "zone");
    const rate = await ok(await call("POST", "/admin/shipping/rates", { zoneId: zone.id, name: "Estándar", price: 15000, minDays: 2, maxDays: 5 }, ownerToken), "rate");
    rateId = rate.id;
    await ok(await call("POST", "/admin/discounts", { code: `SMOKE10${stamp}`, title: "10%", type: "percent", value: 10 }, ownerToken), "discount");
  });

  let cart, order, orderId, orderToken;
  const code = () => `SMOKE10${stamp}`;

  await check("commerce: cart requires its token (404 otherwise); prices come from the server", async () => {
    cart = await newCart();
    const noTok = await fetch(`${api}/storefront/carts/${cart.id}`);
    assert(noTok.status === 400 || noTok.status === 404, `no token → ${noTok.status}`);
    const wrong = await fetch(`${api}/storefront/carts/${cart.id}`, { headers: { "x-cart-token": "x".repeat(43) } });
    assert(wrong.status === 404, `wrong token → ${wrong.status}`);
    await ok(await addLine(cart, variantId, 2), "add line");
    const over = await addLine(cart, variantId, 1);
    assert(over.status === 409, `3rd unit with 2 in stock → ${over.status}`);
    const q = await ok(await call("GET", `/storefront/carts/${cart.id}`, undefined, undefined, cart.hdr), "get cart");
    const quote = q.quote ?? q;
    assert((quote.subtotal ?? quote.quote?.subtotal) === 2 * PRICE, `subtotal ${JSON.stringify(quote).slice(0, 200)}`);
  });

  await check("commerce: shipping rates by department and a discount code change the quote", async () => {
    const rates = await ok(await call("GET", `/storefront/shipping-rates?department=Cundinamarca&cartId=${cart.id}`, undefined, undefined, cart.hdr), "rates");
    assert(items(rates).some((r) => r.id === rateId), "rate not offered");
    await ok(await call("PUT", `/storefront/carts/${cart.id}/discount`, { code: code() }, undefined, cart.hdr), "apply discount");
    const bad = await call("PUT", `/storefront/carts/${cart.id}/discount`, { code: "NOPE-NOPE" }, undefined, cart.hdr);
    assert(bad.status === 422, `unknown code → ${bad.status}`);
  });

  await check("commerce: a zone that names the department wins over the catch-all zone", async () => {
    const zone = await ok(await call("POST", "/admin/shipping/zones", { name: `Smoke Bogotá ${stamp}`, departments: ["Bogotá D.C."] }, ownerToken), "bogotá zone");
    const bogota = await ok(await call("POST", "/admin/shipping/rates", { zoneId: zone.id, name: "Bogotá", price: 8000 }, ownerToken), "bogotá rate");
    const offered = async (department) => items(await ok(await call("GET", `/storefront/shipping-rates?department=${encodeURIComponent(department)}&cartId=${cart.id}`, undefined, undefined, cart.hdr), "rates")).map((r) => r.id);
    const inBogota = await offered("Bogotá D.C.");
    assert(inBogota.includes(bogota.id) && !inBogota.includes(rateId), "Bogotá must see only its own rate");
    const inAntioquia = await offered("Antioquia");
    assert(inAntioquia.includes(rateId) && !inAntioquia.includes(bogota.id), "Antioquia must see only the nationwide rate");
    const wrong = await call("POST", "/storefront/checkouts", { cartId: cart.id, email: `x-${stamp}@dept.test`, shippingAddress: { ...address, department: "Bogotá D.C." }, shippingRateId: rateId }, undefined, { ...cart.hdr, "idempotency-key": `idem-${stamp}-zone` });
    assert(wrong.status === 422, `nationwide rate for Bogotá should be rejected, got ${wrong.status}`);
    await call("DELETE", `/admin/shipping/rates/${bogota.id}`, undefined, ownerToken);
    await call("DELETE", `/admin/shipping/zones/${zone.id}`, undefined, ownerToken);
  });

  await check("commerce: cart quote with shippingRateId+department adds shipping, IVA breakdown and product handle (optional)", async () => {
    const plain = (await ok(await call("GET", `/storefront/carts/${cart.id}`, undefined, undefined, cart.hdr), "plain cart")).quote;
    assert(plain.shippingTotal === 0 && plain.shippingRate === null, "plain quote must not include shipping");
    assert(typeof plain.taxIncluded === "boolean" && typeof plain.taxRatePercent === "number", "taxIncluded/taxRatePercent missing");
    assert(plain.lines[0].productHandle === handle, `productHandle ${plain.lines[0].productHandle} !== ${handle}`);
    const withShip = (await ok(await call("GET", `/storefront/carts/${cart.id}?shippingRateId=${rateId}&department=Cundinamarca`, undefined, undefined, cart.hdr), "ship cart")).quote;
    assert(withShip.shippingTotal === 15000 && withShip.shippingRate?.id === rateId, `shippingTotal ${withShip.shippingTotal}`);
    const b = withShip.taxBreakdown;
    const base = withShip.subtotal - withShip.discountTotal + withShip.shippingTotal;
    assert(b && b.taxAmount === withShip.taxTotal && b.ratePercent === withShip.taxRatePercent, "taxBreakdown mismatch");
    assert(withShip.total === (withShip.taxIncluded ? base : base + withShip.taxTotal), `total ${withShip.total}`);
    assert(b.netAmount === (withShip.taxIncluded ? base - withShip.taxTotal : base), "netAmount");
    const half = await call("GET", `/storefront/carts/${cart.id}?shippingRateId=${rateId}`, undefined, undefined, cart.hdr);
    assert(half.status === 400, `shippingRateId without department → ${half.status}`);
    const nope = await call("GET", `/storefront/carts/${cart.id}?shippingRateId=${crypto.randomUUID()}&department=Cundinamarca`, undefined, undefined, cart.hdr);
    assert(nope.status === 422, `unknown rate → ${nope.status}`);
    const noTok = await fetch(`${api}/storefront/shipping-rates?department=Cundinamarca&cartId=${cart.id}`);
    assert(noTok.status === 400 || noTok.status === 404, `shipping-rates without X-Cart-Token → ${noTok.status}`);
  });

  await check("commerce: GET /admin/inventory filters by variantId and productId", async () => {
    const byVariant = items(await ok(await call("GET", `/admin/inventory?variantId=${variantId}`, undefined, ownerToken), "by variant"));
    assert(byVariant.length >= 1 && byVariant.every((r) => r.variantId === variantId), "variantId filter");
    const productId = byVariant[0].product?.id ?? byVariant[0].productId;
    assert(productId, "inventory row has no product id");
    const byProduct = items(await ok(await call("GET", `/admin/inventory?productId=${productId}`, undefined, ownerToken), "by product"));
    assert(byProduct.length >= 1 && byProduct.every((r) => r.variantId === variantId), "productId filter");
    const none = items(await ok(await call("GET", `/admin/inventory?productId=${crypto.randomUUID()}`, undefined, ownerToken), "no match"));
    assert(none.length === 0, "unknown productId should match nothing");
  });

  await check("commerce: checkout is idempotent; other body with same key → 422; stock is reserved", async () => {
    const key = `idem-${stamp}-1`;
    const r1 = await doCheckout(cart, key);
    order = await ok(r1, "checkout");
    const expectedTotal = 2 * PRICE - 0.1 * 2 * PRICE + 15000;
    assert(order.total === expectedTotal, `total ${order.total} !== ${expectedTotal}`);
    assert(order.payment?.provider === "mock" && order.accessToken, "payment instructions / token missing");
    orderToken = order.accessToken;
    const r2 = await doCheckout(cart, key);
    const again = await ok(r2, "replay");
    assert(again.orderNumber === order.orderNumber, "replay created another order");
    assert(again.accessToken === order.accessToken, "a replay must return the SAME accessToken");
    orderToken = again.accessToken;
    const firstStillValid = await fetch(`${api}/storefront/orders/${order.orderNumber}?token=${order.accessToken}`);
    assert(firstStillValid.status === 200, `token of the first response after a replay → ${firstStillValid.status}`);
    const other = await doCheckout(cart, key, { customerNote: "different body" });
    assert(other.status === 422, `changed body → ${other.status}`);
    assert((await available(handle)) === false, "stock should be reserved (unavailable)");
    orderId = await orderIdByNumber(order.orderNumber);
  });

  await check("commerce: converted cart is flagged; pending public order carries variantId, productHandle and payment instructions", async () => {
    const c = await ok(await call("GET", `/storefront/carts/${cart.id}`, undefined, undefined, cart.hdr), "converted cart");
    assert(c.converted === true && c.convertedOrderNumber === order.orderNumber, `converted ${c.converted}/${c.convertedOrderNumber}`);
    const pub = await ok(await fetch(`${api}/storefront/orders/${order.orderNumber}?token=${orderToken}`), "public order");
    assert(pub.lines[0].variantId === variantId && pub.lines[0].productHandle === handle, "line variantId/productHandle");
    const ins = pub.payment?.instructions;
    assert(ins && ins.reference === order.payment.reference && ins.provider === order.payment.provider && ins.amountInCents === order.payment.amountInCents, "payment instructions missing or different");
  });

  await check("commerce: webhook with a bad signature → 401; mock approval → order open/paid (idempotent)", async () => {
    const bad = await fetch(`${base}/webhooks/wompi`, { method: "POST", headers: { "content-type": "application/json", "x-event-checksum": "deadbeef" }, body: JSON.stringify({ event: "transaction.updated", data: {}, signature: { checksum: "deadbeef", properties: [] }, timestamp: 1 }) });
    assert(bad.status === 401, `bad signature → ${bad.status}`);
    // a PENDING event (PSE, Nequi…) is stored and does not move the order; the approval that follows pays it
    const pend = await ok(await mockPay(order.payment.reference, "pending"), "pending event");
    assert(pend.outcome === "pending", `pending outcome ${pend.outcome}`);
    assert((await adminOrder(orderId)).status === "pending", "a PENDING event must not change the order");
    const first = await mockPay(order.payment.reference, "approved");
    assert(first.status < 300, `mock approve ${first.status} ${await first.clone().text()}`);
    const second = await mockPay(order.payment.reference, "approved");
    assert(second.status < 300, `duplicate approve ${second.status}`);
    const pub = await ok(await fetch(`${api}/storefront/orders/${order.orderNumber}?token=${orderToken}`), "public order");
    assert(pub.status === "open" && pub.paymentStatus === "paid", `status ${pub.status}/${pub.paymentStatus}`);
    const noTok = await fetch(`${api}/storefront/orders/${order.orderNumber}?token=${"y".repeat(43)}`);
    assert(noTok.status === 404, `wrong order token → ${noTok.status}`);
  });

  await check("commerce: stock was committed exactly once (on hand 2 → 0)", async () => {
    const inv = items(await ok(await call("GET", `/admin/inventory?q=SC-${stamp}&pageSize=100`, undefined, ownerToken), "inventory"));
    const row = inv.find((r) => r.variantId === variantId);
    assert(row && row.onHand === 0 && row.reserved === 0, `onHand ${row?.onHand} reserved ${row?.reserved}`);
  });

  await check("commerce: fulfillment with tracking completes the order", async () => {
    const detail = await adminOrder(orderId);
    const line = detail.lines[0];
    await ok(await call("POST", `/admin/orders/${orderId}/fulfillments`, { lines: [{ orderLineId: line.id, quantity: 2 }], carrier: "Servientrega", trackingNumber: "SV123", trackingUrl: "https://example.com/t/SV123" }, ownerToken), "fulfill");
    const after = await adminOrder(orderId);
    assert(after.status === "completed" && after.fulfillmentStatus === "fulfilled", `${after.status}/${after.fulfillmentStatus}`);
    const over = await call("POST", `/admin/orders/${orderId}/fulfillments`, { lines: [{ orderLineId: line.id, quantity: 1 }] }, ownerToken);
    assert(over.status >= 400 && over.status < 500, `over-fulfilling → ${over.status}`);
  });

  await check("commerce: partial refund with restock; cannot refund more than paid; analyst → 403", async () => {
    const detail = await adminOrder(orderId);
    const line = detail.lines[0];
    await ok(await call("POST", `/admin/orders/${orderId}/refunds`, { amount: PRICE, lines: [{ orderLineId: line.id, quantity: 1 }], restock: true, reason: "smoke" }, ownerToken), "refund");
    const after = await adminOrder(orderId);
    assert(after.totalRefunded === PRICE && after.paymentStatus === "partially_refunded", `${after.totalRefunded}/${after.paymentStatus}`);
    assert((await available(handle)) === true, "restock should make the product available again");
    // 1 of 2 units already restocked: asking to restock 2 more would put back more than was ever taken out
    const double = await call("POST", `/admin/orders/${orderId}/refunds`, { amount: 1, lines: [{ orderLineId: line.id, quantity: 2 }], restock: true }, ownerToken);
    assert(double.status === 409, `restock beyond the committed units → ${double.status}`);
    const tooMuch = await call("POST", `/admin/orders/${orderId}/refunds`, { amount: 10 * PRICE, restock: false }, ownerToken);
    assert(tooMuch.status >= 400 && tooMuch.status < 500, `refund above paid → ${tooMuch.status}`);
    if (analystToken) {
      const denied = await call("POST", `/admin/orders/${orderId}/refunds`, { amount: 1, restock: false }, analystToken);
      assert(denied.status === 403, `analyst refund → ${denied.status}`);
    }
  });

  await check("commerce: cancelling a pending order releases the reservation; a late approval flags refund-pending", async () => {
    const c = await newCart();
    await ok(await addLine(c, variantId, 1), "add");
    const o = await ok(await doCheckout(c, `idem-${stamp}-2`), "checkout 2");
    assert((await available(handle)) === false, "1 unit left should now be reserved");
    const id = await orderIdByNumber(o.orderNumber);
    await ok(await call("POST", `/admin/orders/${id}/cancel`, { reason: "smoke", restock: false }, ownerToken), "cancel");
    assert((await available(handle)) === true, "reservation not released");
    const late = await mockPay(o.payment.reference, "approved");
    assert(late.status < 300, `late approval ${late.status}`);
    const d = await adminOrder(id);
    assert(d.status === "cancelled" && (d.tags ?? []).includes("refund-pending"), `${d.status} tags=${JSON.stringify(d.tags)}`);
    // stock was released, never committed: a refund with restock would create phantom stock
    const phantom = await call("POST", `/admin/orders/${id}/refunds`, { amount: 1, lines: [{ orderLineId: d.lines[0].id, quantity: 1 }], restock: true }, ownerToken);
    assert(phantom.status === 409, `restock on a never-committed order → ${phantom.status}`);
  });

  await check("commerce: a discount with usageLimit=1 is redeemed by only one of two parallel checkouts", async () => {
    const prod = await newProduct(`Smoke Race ${stamp}`, 5);
    const limited = `LIMIT1${stamp}`;
    await ok(await call("POST", "/admin/discounts", { code: limited, title: "one use", type: "fixed", value: 5000, usageLimit: 1 }, ownerToken), "limited discount");
    const carts = [await newCart(), await newCart()];
    for (const c of carts) {
      await ok(await addLine(c, prod.variantId, 1), "add");
      await ok(await call("PUT", `/storefront/carts/${c.id}/discount`, { code: limited }, undefined, c.hdr), "apply");
    }
    const results = await Promise.all(carts.map((c, i) => doCheckout(c, `idem-${stamp}-race-${i}`, { email: `race${i}-${stamp}@dept.test` })));
    const wins = results.filter((r) => r.status < 300).length;
    assert(wins === 1, `${wins} checkouts redeemed a single-use code (${results.map((r) => r.status)})`);
  });

  await check("commerce: a once-per-email code is rejected as already_used when the cart sends the e-mail", async () => {
    const prod = await newProduct(`Smoke Once ${stamp}`, 3);
    const once = `ONCE${stamp}`;
    const buyer = `once-${stamp}@dept.test`;
    await ok(await call("POST", "/admin/discounts", { code: once, title: "once", type: "fixed", value: 5000, oncePerEmail: true }, ownerToken), "once discount");
    const c1 = await newCart();
    await ok(await addLine(c1, prod.variantId, 1), "add");
    await ok(await call("PUT", `/storefront/carts/${c1.id}/discount`, { code: once, email: buyer }, undefined, c1.hdr), "apply (unused)");
    await ok(await doCheckout(c1, `idem-${stamp}-once`, { email: buyer }), "checkout once");
    const c2 = await newCart();
    await ok(await addLine(c2, prod.variantId, 1), "add 2");
    const used = await call("PUT", `/storefront/carts/${c2.id}/discount`, { code: once, email: buyer.toUpperCase() }, undefined, c2.hdr);
    const body = await used.json();
    assert(used.status === 422 && body.details?.reason === "already_used", `already_used → ${used.status} ${JSON.stringify(body)}`);
    const other = await call("PUT", `/storefront/carts/${c2.id}/discount`, { code: once, email: `new-${stamp}@dept.test` }, undefined, c2.hdr);
    assert(other.status === 200, `other e-mail → ${other.status}`);
    const noEmail = await call("PUT", `/storefront/carts/${c2.id}/discount`, { code: once }, undefined, c2.hdr);
    assert(noEmail.status === 200, `no e-mail still accepted → ${noEmail.status}`);
    // X-Quote-Email is equivalent to ?email= on the quote
    for (const who of [buyer, `new-${stamp}@dept.test`]) {
      const viaQuery = await call("GET", `/storefront/carts/${c2.id}?email=${encodeURIComponent(who)}`, undefined, undefined, c2.hdr);
      const viaHeader = await call("GET", `/storefront/carts/${c2.id}`, undefined, undefined, { ...c2.hdr, "x-quote-email": who });
      assert(viaQuery.status === viaHeader.status, `X-Quote-Email status ${viaHeader.status} vs query ${viaQuery.status}`);
      assert(JSON.stringify((await viaQuery.json()).quote) === JSON.stringify((await viaHeader.json()).quote), "X-Quote-Email quote differs from ?email=");
    }
    const badHeader = await call("GET", `/storefront/carts/${c2.id}`, undefined, undefined, { ...c2.hdr, "x-quote-email": "not-an-email" });
    assert(badHeader.status === 400, `invalid X-Quote-Email → ${badHeader.status}`);
  });

  await check("commerce: dev mock endpoint validates input; shipping/discount admin is permission-guarded", async () => {
    const r = await call("POST", "/storefront/dev/mock-payment", { reference: "x", status: "bogus" });
    assert(r.status === 400, `bad status → ${r.status}`);
    if (analystToken) {
      const d = await call("POST", "/admin/discounts", { code: "NOPE1", title: "x", type: "percent", value: 5 }, analystToken);
      assert(d.status === 403, `analyst discount → ${d.status}`);
    }
  });
  return { buyerEmail: `buyer-${stamp}@dept.test`, orderNumber: order?.orderNumber };
}
