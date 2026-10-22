import { EntityManager } from "typeorm";
import { Actor } from "../../common/auth/actor";
import { AppException } from "../../common/errors/app-exception";
import { OrderEvent } from "../entities/order-event.entity";

export interface EventActor {
  type: string;
  id: string | null;
}

export function toEventActor(actor: Actor): EventActor {
  if (actor.kind === "staff") return { type: "staff", id: actor.staffId };
  return { type: actor.kind === "apiKey" ? "api_key" : actor.kind, id: null };
}

export interface LockedOrder {
  id: string;
  orderNumber: number;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  total: number;
  totalRefunded: number;
  /** null while the stock was never committed (unpaid, expired or cancelled before payment). */
  paidAt: Date | null;
  version: number;
}

interface LockedOrderRow {
  id: string;
  order_number: number;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  total: string;
  total_refunded: string;
  paid_at: Date | null;
  version: number;
}

/** Lock order: ALWAYS order first, then its lines (see lockLines). */
export async function lockOrder(manager: EntityManager, orderId: string): Promise<LockedOrder> {
  const rows: LockedOrderRow[] = await manager.query(
    `SELECT id, order_number, status, payment_status, fulfillment_status, total, total_refunded, paid_at, version
       FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId],
  );
  const row = rows[0];
  if (!row) throw AppException.notFound("Order");
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    total: Number(row.total),
    totalRefunded: Number(row.total_refunded),
    paidAt: row.paid_at,
    version: row.version,
  };
}

export interface LockedLine {
  id: string;
  variantId: string;
  quantity: number;
  fulfilledQuantity: number;
  refundedQuantity: number;
  /** Units already put back into on_hand (refund with restock or cancellation with restock). */
  restockedQuantity: number;
}

interface LockedLineRow {
  id: string;
  variant_id: string;
  quantity: number;
  fulfilled_quantity: number;
  refunded_quantity: number;
  restocked_quantity: number;
}

/** Must be called after lockOrder, in the same transaction. Deterministic order (id) to avoid deadlocks. */
export async function lockLines(manager: EntityManager, orderId: string): Promise<Map<string, LockedLine>> {
  const rows: LockedLineRow[] = await manager.query(
    `SELECT id, variant_id, quantity, fulfilled_quantity, refunded_quantity, restocked_quantity
       FROM order_lines WHERE order_id = $1 ORDER BY id FOR UPDATE`,
    [orderId],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        variantId: r.variant_id,
        quantity: r.quantity,
        fulfilledQuantity: r.fulfilled_quantity,
        refundedQuantity: r.refunded_quantity,
        restockedQuantity: r.restocked_quantity,
      },
    ]),
  );
}

/** Units of a line that can still be shipped: refunded-but-never-shipped units are not shippable. */
export function shippableQuantity(line: LockedLine): number {
  return line.quantity - Math.max(line.fulfilledQuantity, line.refundedQuantity);
}

export function computeFulfillmentStatus(lines: Iterable<LockedLine>): "unfulfilled" | "partial" | "fulfilled" {
  let anyShipped = false;
  let allDone = true;
  let any = false;
  for (const l of lines) {
    any = true;
    if (l.fulfilledQuantity > 0) anyShipped = true;
    if (Math.max(l.fulfilledQuantity, l.refundedQuantity) < l.quantity) allDone = false;
  }
  if (!any || !anyShipped) return "unfulfilled";
  return allDone ? "fulfilled" : "partial";
}

/** Runs a `WITH u AS (UPDATE … RETURNING …) SELECT` style statement and returns how many rows were updated. */
export async function execUpdate(manager: EntityManager, updateSql: string, params: unknown[]): Promise<number> {
  const rows: unknown[] = await manager.query(`WITH u AS (${updateSql} RETURNING 1) SELECT 1 FROM u`, params);
  return rows.length;
}

export async function recordOrderEvent(
  manager: EntityManager,
  orderId: string,
  type: string,
  data: Record<string, unknown>,
  actor: EventActor,
): Promise<OrderEvent> {
  const repo = manager.getRepository(OrderEvent);
  const event = repo.create({ orderId, type, data, actorType: actor.type, actorId: actor.id });
  return repo.save(event);
}
