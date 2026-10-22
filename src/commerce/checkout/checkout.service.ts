import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { Clock } from "../../common/clock/clock";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { TransactionService } from "../../database/transaction.service";
import { openSecret, sealSecret } from "../../common/crypto/secret-box";
import { rowsOf } from "../../common/sql/query-result";
import { InventoryService } from "../../inventory/inventory.service";
import { Cart, CartLine, Discount, DiscountRedemption, Fulfillment, Order, OrderEvent, OrderLine, Payment } from "../entities";
import { PAYMENT_PROVIDER, PaymentProvider, type PaymentInstructions } from "../payments/payment-provider";
import { safeEqual } from "../payments/safe-equal";
import { CustomerTokenService } from "../../customers/auth/customer-token.service";
import { PricingService } from "../pricing/pricing.service";
import type { Quote } from "../pricing/pricing.types";
import { CheckoutInput, CheckoutResponseDto, PublicOrderDto, StoredCheckoutResponse } from "./checkout.dto";

const SCOPE = "checkout";
const CREATED = 201;
/** Quote warnings that make the purchase impossible (stock shortages are raised precisely by `reserve`). */
const BLOCKING_WARNINGS = new Set<string>(["VARIANT_UNAVAILABLE"]);

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Deterministic JSON (sorted keys, `undefined` dropped) so the same body always hashes the same. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const isStoredResponse = (value: unknown): value is StoredCheckoutResponse =>
  typeof value === "object" && value !== null && typeof (value as { orderId?: unknown }).orderId === "string";

interface IdempotencyRow {
  id: string;
  request_hash: string;
  status: string;
  response: unknown;
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
    private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly customerTokens: CustomerTokenService,
  ) {}

  /**
   * Creates the order in ONE transaction: cart lock, idempotency lock, quote, stock reservation, order + lines +
   * payment + event, discount redemption (atomic increment) and cart conversion. Any failure rolls back everything,
   * including the idempotency row, so the client can retry safely.
   *
   * Idempotent replay: the stored response keeps the accessToken only sealed (ENCRYPTION_KEY). A replay (same key + same body)
   * returns the same order, payment instructions AND the same accessToken; nothing is rotated, so the first response's token stays valid.
   */
  async create(input: CheckoutInput, idempotencyKey: string, cartToken: string, customerBearer?: string): Promise<CheckoutResponseDto> {
    const requestHash = sha256Hex(canonicalize(input));
    const customerId = customerBearer ? await this.customerTokens.verify(customerBearer) : null;
    return this.transactions.run((manager) => this.createInTransaction(manager, input, idempotencyKey, cartToken, requestHash, customerId));
  }

  /** The signed-in customer owns the order only when the checkout e-mail is their VERIFIED account e-mail (never link by claim alone). */
  private async linkableCustomer(manager: EntityManager, customerId: string | null, email: string): Promise<string | null> {
    if (!customerId) return null;
    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM customers WHERE id = $1 AND is_active = true AND anonymized_at IS NULL AND email_verified_at IS NOT NULL AND lower(email) = lower($2) AND deleted_at IS NULL`,
      [customerId, email],
    );
    return rows[0]?.id ?? null;
  }

  private async createInTransaction(
    manager: EntityManager,
    input: CheckoutInput,
    idempotencyKey: string,
    cartToken: string,
    requestHash: string,
    signedInCustomerId: string | null,
  ): Promise<CheckoutResponseDto> {
    const now = this.clock.now();

    // 1. Cart: serializes concurrent checkouts of the same cart; the token is checked BEFORE any replay is served.
    const cart = await manager.getRepository(Cart).findOne({ where: { id: input.cartId }, lock: { mode: "pessimistic_write" } });
    if (!cart || !safeEqual(sha256Hex(cartToken), cart.tokenHash)) throw AppException.notFound("Cart");

    // 2. Idempotency: INSERT ... ON CONFLICT DO NOTHING, then lock the row.
    const insertedRes = await manager.query<{ id: string }[]>(
      `INSERT INTO idempotency_keys (id, scope, "key", request_hash, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'in_progress', $5, $5)
       ON CONFLICT (scope, "key") DO NOTHING
       RETURNING id`,
      [uuidv7(), SCOPE, idempotencyKey, requestHash, now],
    );
    const inserted = rowsOf<{ id: string }>(insertedRes);
    const rows = await manager.query<IdempotencyRow[]>(
      `SELECT id, request_hash, status, response FROM idempotency_keys WHERE scope = $1 AND "key" = $2 FOR UPDATE`,
      [SCOPE, idempotencyKey],
    );
    const idem = rows[0];
    if (!idem) throw AppException.conflict("CONCURRENT_UPDATE", "Could not lock the idempotency key, please retry");
    if (idem.request_hash !== requestHash) {
      throw new AppException(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request");
    }
    if (idem.status === "done") return this.replay(manager, idem.response, now);
    // an `in_progress` row we did not just insert belongs to a request that never finished
    if (inserted.length === 0) throw AppException.conflict("IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is still being processed");

    // 3. Cart checks
    if (cart.convertedOrderId) throw AppException.conflict("CART_ALREADY_CONVERTED", "This cart was already checked out");
    if (cart.expiresAt.getTime() <= now.getTime()) throw AppException.conflict("CART_EXPIRED", "This cart has expired");
    const lines = await manager.getRepository(CartLine).find({ where: { cartId: cart.id }, order: { createdAt: "ASC" } });
    if (lines.length === 0) throw AppException.badRequest("CART_EMPTY", "The cart is empty");

    // 4. Prices are ALWAYS computed here; the client never sends them.
    const discountCode = input.discountCode ?? cart.discountCode ?? null;
    const quote = await this.pricing.quote(
      {
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        discountCode,
        shippingRateId: input.shippingRateId,
        department: input.shippingAddress.department,
        email: input.email,
      },
      manager,
    );
    this.assertPurchasable(quote);

    // 5. Stock (409 INSUFFICIENT_STOCK with details) — locks in a stable order
    const reserved = await this.inventory.reserve(
      quote.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      manager,
    );
    // What was REALLY reserved per variant (untracked / backorderable variants reserve nothing); it drives commit/release later.
    const reservedLeft = new Map(reserved.map((r) => [r.variantId, r.quantity]));

    // 6. Order, lines, payment, event
    const accessToken = randomBytes(32).toString("base64url");
    const orderRepo = manager.getRepository(Order);
    const reservedUntil = new Date(now.getTime() + this.env.ORDER_RESERVATION_MINUTES * 60_000);
    const created = await orderRepo.save(
      orderRepo.create({
        accessTokenHash: sha256Hex(accessToken),
        email: input.email,
        phone: input.phone ?? null,
        customerId: await this.linkableCustomer(manager, signedInCustomerId, input.email),
        status: "pending",
        paymentStatus: "pending",
        fulfillmentStatus: "unfulfilled",
        currency: quote.currency,
        subtotal: quote.subtotal,
        discountTotal: quote.discountTotal,
        shippingTotal: quote.shippingTotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        discountCode: quote.discount?.code ?? null,
        shippingRateName: quote.shippingRate?.name ?? null,
        shippingAddress: input.shippingAddress,
        billingAddress: input.billingAddress ?? null,
        customerNote: input.customerNote ?? null,
        reservedUntil,
        paymentProvider: this.provider.name,
        paymentReference: `DR${randomBytes(12).toString("hex").toUpperCase()}`,
        idempotencyKeyId: idem.id,
      }),
    );
    // reload: `orderNumber` comes from the sequence default
    const order = await orderRepo.findOneOrFail({ where: { id: created.id } });

    const lineRepo = manager.getRepository(OrderLine);
    await lineRepo.save(
      quote.lines.map((l) => {
        const take = Math.min(l.quantity, reservedLeft.get(l.variantId) ?? 0);
        reservedLeft.set(l.variantId, (reservedLeft.get(l.variantId) ?? 0) - take);
        return lineRepo.create({
          orderId: order.id,
          variantId: l.variantId,
          productId: l.productId,
          sku: l.sku,
          title: l.productTitle,
          variantTitle: l.variantTitle,
          imageUrl: l.imageUrl,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          lineTotal: l.lineTotal,
          reservedQuantity: take,
        });
      }),
    );
    const paymentRepo = manager.getRepository(Payment);
    await paymentRepo.save(
      paymentRepo.create({
        orderId: order.id,
        provider: this.provider.name,
        reference: order.paymentReference,
        amount: order.total,
        currency: order.currency,
        status: "pending",
      }),
    );
    const eventRepo = manager.getRepository(OrderEvent);
    await eventRepo.save(
      eventRepo.create({
        orderId: order.id,
        type: "order.created",
        data: { total: order.total, currency: order.currency, lines: quote.lines.length, discountCode: order.discountCode },
        actorType: "guest",
        actorId: null,
      }),
    );

    // 7. Discount: atomic increment with row verification (usageLimit cannot be exceeded under concurrency)
    if (quote.discount) await this.redeemDiscount(manager, quote.discount.code, quote.discount.amount, order.id, input.email);

    // 8. Cart converted
    await manager.getRepository(Cart).update({ id: cart.id }, { convertedOrderId: order.id });

    // 9. Response + idempotent record (WITHOUT the access token)
    const stored: StoredCheckoutResponse = {
      orderNumber: order.orderNumber,
      orderId: order.id,
      total: order.total,
      currency: order.currency,
      payment: this.provider.createPayment(order),
      accessTokenEnc: sealSecret(this.env, accessToken),
    };
    await manager.query(
      `UPDATE idempotency_keys SET status = 'done', response_status = $2, response = $3::jsonb, updated_at = $4 WHERE id = $1`,
      [idem.id, CREATED, JSON.stringify(stored), now],
    );
    const { accessTokenEnc: _sealed, ...publicResponse } = stored;
    return { ...publicResponse, accessToken };
  }

  private async replay(manager: EntityManager, response: unknown, now: Date): Promise<CheckoutResponseDto> {
    if (!isStoredResponse(response)) throw AppException.conflict("IDEMPOTENCY_IN_PROGRESS", "The stored response is not available yet");
    const current = await manager.query<{ status: string }[]>(`SELECT status FROM orders WHERE id = $1`, [response.orderId]);
    if (current[0]?.status !== "pending") {
      throw AppException.conflict("ORDER_NOT_PAYABLE", "This order can no longer be paid");
    }
    const { accessTokenEnc, ...publicResponse } = response;
    const sameToken = accessTokenEnc ? openSecret(this.env, accessTokenEnc) : null;
    if (sameToken) return { ...publicResponse, accessToken: sameToken };
    // legacy rows (stored before the token was sealed) or an unreadable seal: issue a new token, as before
    const accessToken = randomBytes(32).toString("base64url");
    await manager.query(`UPDATE orders SET access_token_hash = $2, version = version + 1, updated_at = $3 WHERE id = $1`, [
      response.orderId,
      sha256Hex(accessToken),
      now,
    ]);
    return { ...publicResponse, accessToken };
  }

  private assertPurchasable(quote: Quote): void {
    const blocking = quote.warnings.filter((w) => BLOCKING_WARNINGS.has(w.code));
    const unavailable = quote.lines.filter((l) => !l.available && blocking.some((w) => w.variantId === l.variantId));
    if (blocking.length > 0 || unavailable.length > 0) {
      const first = blocking[0];
      throw AppException.conflict(first?.code ?? "VARIANT_UNAVAILABLE", first?.message ?? "Some items are no longer available", {
        warnings: blocking,
      });
    }
    if (quote.lines.length === 0) throw AppException.badRequest("CART_EMPTY", "The cart is empty");
    if (!quote.shippingRate) throw new AppException(422, "SHIPPING_RATE_INVALID", "A valid shipping rate is required");
    if (quote.total <= 0) throw AppException.badRequest("INVALID_TOTAL", "The order total must be greater than zero");
  }

  private async redeemDiscount(manager: EntityManager, code: string, amount: number, orderId: string, email: string): Promise<void> {
    const discountRepo = manager.getRepository(Discount);
    const discount = await discountRepo.findOne({ where: { code: code.trim().toUpperCase() }, lock: { mode: "pessimistic_write" } });
    if (!discount) throw new AppException(422, "DISCOUNT_INVALID", "The discount code is not valid", { reason: "not_found" });

    const redemptionRepo = manager.getRepository(DiscountRedemption);
    if (discount.oncePerEmail) {
      // the discount row is locked, so concurrent redemptions of the same code are serialized here
      const used = await redemptionRepo
        .createQueryBuilder("r")
        .where("r.discountId = :id AND lower(r.email) = :email", { id: discount.id, email: email.toLowerCase() })
        .getCount();
      if (used > 0) throw new AppException(422, "DISCOUNT_INVALID", "The discount code is not valid", { reason: "already_used" });
    }

    const result = await discountRepo
      .createQueryBuilder()
      .update()
      .set({ usedCount: () => "used_count + 1" })
      .where("id = :id AND (usage_limit IS NULL OR used_count < usage_limit)", { id: discount.id })
      .execute();
    if (result.affected !== 1) {
      throw new AppException(422, "DISCOUNT_INVALID", "The discount code is not valid", { reason: "usage_limit_reached" });
    }

    await redemptionRepo.save(redemptionRepo.create({ discountId: discount.id, orderId, email, amount }));
  }

  /** Payment instructions are deterministic for an order (same reference/amount); a misconfigured provider yields null. */
  private safeInstructions(order: Order): PaymentInstructions | null {
    try {
      return this.provider.createPayment(order);
    } catch {
      return null;
    }
  }

  /* ── public order status ── */

  /** Public status page. The token is compared in constant time against the stored hash; a mismatch is a 404. */
  async getPublicOrder(orderNumber: number, token: string): Promise<PublicOrderDto> {
    const order = await this.orders.findOne({ where: { orderNumber } });
    const expected = order?.accessTokenHash ?? sha256Hex("no-such-order");
    let matches = safeEqual(sha256Hex(token), expected);
    if (order && !matches) {
      // link from an e-mail: a token minted for THIS order (hashed in order_access_tokens, expires)
      const mail = await this.orders.manager.query<{ id: string }[]>(
        `SELECT id FROM order_access_tokens WHERE order_id = $1 AND token_hash = $2 AND expires_at > now() LIMIT 1`,
        [order.id, sha256Hex(token)],
      );
      matches = mail.length > 0;
    }
    if (!order || !matches) throw AppException.notFound("Order");

    const manager = this.orders.manager;
    const lines = await manager.getRepository(OrderLine).find({ where: { orderId: order.id }, order: { createdAt: "ASC", id: "ASC" } });
    const fulfillments = await manager.getRepository(Fulfillment).find({ where: { orderId: order.id }, order: { shippedAt: "ASC" } });
    const payment = await manager.getRepository(Payment).findOne({ where: { orderId: order.id }, order: { createdAt: "DESC" } });
    const handles = new Map<string, string>();
    const productIds = [...new Set(lines.map((l) => l.productId))];
    if (productIds.length > 0) {
      const rows = await manager.query<{ id: string; handle: string }[]>(`SELECT id, handle FROM products WHERE id = ANY($1::uuid[])`, [productIds]);
      for (const r of rows) handles.set(r.id, r.handle);
    }
    const instructions = order.status === "pending" && order.paymentProvider === this.provider.name ? this.safeInstructions(order) : null;

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      currency: order.currency,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      shippingTotal: order.shippingTotal,
      taxTotal: order.taxTotal,
      total: order.total,
      discountCode: order.discountCode ?? null,
      shippingRateName: order.shippingRateName ?? null,
      email: order.email,
      shippingAddress: order.shippingAddress,
      lines: lines.map((l) => ({
        variantId: l.variantId,
        productId: l.productId,
        productHandle: handles.get(l.productId) ?? null,
        title: l.title,
        variantTitle: l.variantTitle,
        imageUrl: l.imageUrl ?? null,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
        fulfilledQuantity: l.fulfilledQuantity,
      })),
      fulfillments: fulfillments
        .filter((f) => f.status === "success")
        .map((f) => ({
          status: f.status,
          carrier: f.carrier ?? null,
          trackingNumber: f.trackingNumber ?? null,
          trackingUrl: f.trackingUrl ?? null,
          shippedAt: f.shippedAt,
        })),
      payment: payment ? { provider: payment.provider, status: payment.status, method: payment.method ?? null, instructions } : null,
      createdAt: order.createdAt,
      paidAt: order.paidAt ?? null,
      reservedUntil: order.status === "pending" ? (order.reservedUntil ?? null) : null,
    };
  }
}
