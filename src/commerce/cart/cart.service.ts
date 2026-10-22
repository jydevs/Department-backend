import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { AppException } from "../../common/errors/app-exception";
import { Clock } from "../../common/clock/clock";
import { TransactionService } from "../../database/transaction.service";
import { InventoryService } from "../../inventory/inventory.service";
import { PricingService, type Quote } from "../pricing";
import { CART_MAX_LINES, CART_MAX_QUANTITY, type CartCreatedResponse, type CartResponse, type GetCartQuery } from "./cart.dto";

const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CartRow {
  id: string;
  token_hash: string;
  discount_code: string | null;
  expires_at: Date;
  converted_order_id: string | null;
  converted_order_number?: number | null;
}

interface CartLineRow {
  variant_id: string;
  quantity: number;
}

export const hashCartToken = (token: string): string => createHash("sha256").update(token).digest("hex");

@Injectable()
export class CartService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tx: TransactionService,
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
    private readonly clock: Clock,
  ) {}

  async create(): Promise<CartCreatedResponse> {
    const token = randomBytes(32).toString("base64url");
    const id = uuidv7();
    const expiresAt = new Date(this.clock.now().getTime() + CART_TTL_MS);
    await this.dataSource.query(
      `INSERT INTO carts (id, token_hash, currency, expires_at) VALUES ($1, $2, 'COP', $3)`,
      [id, hashCartToken(token), expiresAt],
    );
    return { id, token, expiresAt };
  }

  async get(id: string, token: string, query: GetCartQuery = {}): Promise<CartResponse> {
    const cart = await this.authenticate(this.dataSource.manager, id, token, false);
    return this.view(this.dataSource.manager, cart, query);
  }

  /** Validated cart quote for other modules (shipping rates, checkout). Same 404 rules as `get`. */
  async quoteFor(
    id: string,
    token: string,
    extra: { shippingRateId?: string | null; department?: string | null; email?: string | null } = {},
  ): Promise<Quote> {
    const cart = await this.authenticate(this.dataSource.manager, id, token, false);
    return (await this.buildQuote(this.dataSource.manager, cart, extra)).quote;
  }

  async addLine(id: string, token: string, variantId: string, quantity: number): Promise<CartResponse> {
    return this.mutate(id, token, async (manager, cart) => {
      const lines = await this.lines(manager, cart.id);
      const existing = lines.find((l) => l.variant_id === variantId);
      const nextQuantity = (existing?.quantity ?? 0) + quantity;
      if (nextQuantity > CART_MAX_QUANTITY) {
        throw AppException.badRequest("MAX_LINE_QUANTITY", `A line cannot exceed ${CART_MAX_QUANTITY} units`);
      }
      if (!existing && lines.length >= CART_MAX_LINES) {
        throw AppException.badRequest("MAX_CART_LINES", `A cart cannot exceed ${CART_MAX_LINES} lines`);
      }
      await this.assertPurchasable(manager, variantId, nextQuantity);
      await manager.query(
        `INSERT INTO cart_lines (id, cart_id, variant_id, quantity) VALUES ($1, $2, $3, $4)
         ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
        [uuidv7(), cart.id, variantId, nextQuantity],
      );
    });
  }

  async setLineQuantity(id: string, token: string, variantId: string, quantity: number): Promise<CartResponse> {
    return this.mutate(id, token, async (manager, cart) => {
      const lines = await this.lines(manager, cart.id);
      if (!lines.some((l) => l.variant_id === variantId)) throw AppException.notFound("Cart line");
      if (quantity === 0) {
        await manager.query(`DELETE FROM cart_lines WHERE cart_id = $1 AND variant_id = $2`, [cart.id, variantId]);
        return;
      }
      await this.assertPurchasable(manager, variantId, quantity);
      await manager.query(`UPDATE cart_lines SET quantity = $3, updated_at = now() WHERE cart_id = $1 AND variant_id = $2`, [
        cart.id,
        variantId,
        quantity,
      ]);
    });
  }

  async removeLine(id: string, token: string, variantId: string): Promise<CartResponse> {
    return this.mutate(id, token, async (manager, cart) => {
      await manager.query(`DELETE FROM cart_lines WHERE cart_id = $1 AND variant_id = $2`, [cart.id, variantId]);
    });
  }

  async setDiscount(id: string, token: string, code: string | null, email?: string): Promise<CartResponse> {
    return this.mutate(id, token, async (manager, cart) => {
      if (code !== null) {
        // Throws 422 DISCOUNT_INVALID with a reason if the code cannot be applied to this cart.
        const lines = await this.lines(manager, cart.id);
        await this.pricing.quote({ lines: this.toQuoteLines(lines), discountCode: code, email: email ?? null }, manager);
      }
      await manager.query(`UPDATE carts SET discount_code = $2, updated_at = now() WHERE id = $1`, [cart.id, code]);
      cart.discount_code = code;
    });
  }

  async remove(id: string, token: string): Promise<void> {
    await this.tx.run(async (manager) => {
      const cart = await this.authenticate(manager, id, token, true);
      await manager.query(`DELETE FROM carts WHERE id = $1`, [cart.id]);
    });
  }

  /** Deletes expired carts in batches; returns how many were removed. */
  async purgeExpired(batchSize: number): Promise<number> {
    const rows = await this.dataSource.query<{ n: number }[]>(
      `WITH d AS (
         DELETE FROM carts WHERE id IN (
           SELECT id FROM carts WHERE expires_at < $1 ORDER BY expires_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED
         ) RETURNING 1
       ) SELECT count(*)::int AS n FROM d`,
      [this.clock.now(), batchSize],
    );
    return rows[0]?.n ?? 0;
  }

  /* ── internals ── */

  private async mutate(
    id: string,
    token: string,
    fn: (manager: EntityManager, cart: CartRow) => Promise<void>,
  ): Promise<CartResponse> {
    return this.tx.run(async (manager) => {
      const cart = await this.authenticate(manager, id, token, true);
      if (cart.converted_order_id) throw AppException.conflict("CART_CONVERTED", "This cart has already been checked out");
      await fn(manager, cart);
      const expiresAt = new Date(this.clock.now().getTime() + CART_TTL_MS);
      await manager.query(`UPDATE carts SET expires_at = $2, updated_at = now() WHERE id = $1`, [cart.id, expiresAt]);
      cart.expires_at = expiresAt;
      return this.view(manager, cart);
    });
  }

  /** 404 (never 403) when the cart does not exist, is expired or the token does not match. */
  private async authenticate(manager: EntityManager, id: string, token: string, lock: boolean): Promise<CartRow> {
    const rows = await manager.query<CartRow[]>(
      `SELECT c.id, c.token_hash, c.discount_code, c.expires_at, c.converted_order_id,
              (SELECT o.order_number FROM orders o WHERE o.id = c.converted_order_id) AS converted_order_number
         FROM carts c WHERE c.id = $1${lock ? " FOR UPDATE OF c" : ""}`,
      [id],
    );
    const cart = rows[0];
    // Compare against a dummy hash when the cart is missing so both paths cost the same.
    const expected = Buffer.from(cart?.token_hash ?? "0".repeat(64), "utf8");
    const presented = Buffer.from(hashCartToken(token), "utf8");
    const matches = expected.length === presented.length && timingSafeEqual(expected, presented);
    if (!cart || !matches || new Date(cart.expires_at) <= this.clock.now()) throw AppException.notFound("Cart");
    return cart;
  }

  private async lines(manager: EntityManager, cartId: string): Promise<CartLineRow[]> {
    return manager.query<CartLineRow[]>(
      `SELECT variant_id, quantity FROM cart_lines WHERE cart_id = $1 ORDER BY created_at ASC, id ASC`,
      [cartId],
    );
  }

  private toQuoteLines(lines: CartLineRow[]): { variantId: string; quantity: number }[] {
    return lines.map((l) => ({ variantId: l.variant_id, quantity: l.quantity }));
  }

  private async assertPurchasable(manager: EntityManager, variantId: string, quantity: number): Promise<void> {
    const sellable = await manager.query<{ id: string }[]>(
      `SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id
       WHERE v.id = $1 AND v.is_active = true AND p.status = 'active' AND p.deleted_at IS NULL`,
      [variantId],
    );
    if (sellable.length === 0) throw AppException.conflict("VARIANT_UNAVAILABLE", "This item is not available", { variantId });
    const stock = (await this.inventory.availabilityFor([variantId])).get(variantId);
    if (stock && !stock.unlimited && stock.available < quantity) {
      throw AppException.conflict("INSUFFICIENT_STOCK", "Not enough stock available", {
        variantId,
        available: stock.available,
        requested: quantity,
      });
    }
  }

  private async buildQuote(
    manager: EntityManager,
    cart: CartRow,
    extra: { shippingRateId?: string | null; department?: string | null; email?: string | null } = {},
  ): Promise<{ quote: Quote; itemCount: number }> {
    const lines = await this.lines(manager, cart.id);
    const base = { lines: this.toQuoteLines(lines), ...extra };
    const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
    try {
      return { quote: await this.pricing.quote({ ...base, discountCode: cart.discount_code }, manager), itemCount };
    } catch (e) {
      // A stored code that stopped being valid (expired, exhausted…) must not break the cart: quote without it.
      if (e instanceof AppException && e.code === "DISCOUNT_INVALID") {
        const quote = await this.pricing.quote({ ...base, discountCode: null }, manager);
        quote.warnings.push({ code: "DISCOUNT_INVALID", message: "The discount code can no longer be applied" });
        return { quote, itemCount };
      }
      throw e;
    }
  }

  private async view(manager: EntityManager, cart: CartRow, query: GetCartQuery = {}): Promise<CartResponse> {
    const { quote, itemCount } = await this.buildQuote(manager, cart, {
      shippingRateId: query.shippingRateId ?? null,
      department: query.department ?? null,
      email: query.email ?? null,
    });
    return {
      id: cart.id,
      currency: "COP",
      discountCode: cart.discount_code,
      itemCount,
      expiresAt: new Date(cart.expires_at),
      converted: cart.converted_order_id !== null,
      convertedOrderNumber: cart.converted_order_number ?? null,
      quote,
    };
  }
}
