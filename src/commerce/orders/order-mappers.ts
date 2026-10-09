import { Fulfillment } from "../entities/fulfillment.entity";
import { FulfillmentLine } from "../entities/fulfillment-line.entity";
import { OrderEvent } from "../entities/order-event.entity";
import { OrderLine } from "../entities/order-line.entity";
import { Payment } from "../entities/payment.entity";
import { Refund } from "../entities/refund.entity";
import { RefundLine } from "../entities/refund-line.entity";
import { FulfillmentDto, OrderEventDto, OrderLineDto, PaymentDto, RefundDto } from "./dto/orders-admin.dto";

export const toOrderLineDto = (l: OrderLine): OrderLineDto => ({
  id: l.id,
  variantId: l.variantId,
  productId: l.productId,
  sku: l.sku ?? null,
  title: l.title,
  variantTitle: l.variantTitle,
  imageUrl: l.imageUrl ?? null,
  unitPrice: l.unitPrice,
  quantity: l.quantity,
  lineTotal: l.lineTotal,
  fulfilledQuantity: l.fulfilledQuantity,
  refundedQuantity: l.refundedQuantity,
});

export const toPaymentDto = (p: Payment): PaymentDto => ({
  id: p.id,
  provider: p.provider,
  providerTransactionId: p.providerTransactionId ?? null,
  reference: p.reference,
  amount: p.amount,
  currency: p.currency,
  status: p.status,
  rawStatus: p.rawStatus ?? null,
  method: p.method ?? null,
  createdAt: p.createdAt,
});

export const toFulfillmentDto = (f: Fulfillment, lines: FulfillmentLine[]): FulfillmentDto => ({
  id: f.id,
  status: f.status,
  carrier: f.carrier ?? null,
  trackingNumber: f.trackingNumber ?? null,
  trackingUrl: f.trackingUrl ?? null,
  shippedAt: f.shippedAt,
  createdAt: f.createdAt,
  lines: lines.map((l) => ({ id: l.id, orderLineId: l.orderLineId, quantity: l.quantity })),
});

export const toRefundDto = (r: Refund, lines: RefundLine[]): RefundDto => ({
  id: r.id,
  amount: r.amount,
  reason: r.reason ?? null,
  restocked: r.restocked,
  providerStatus: r.providerStatus,
  actorId: r.actorId ?? null,
  createdAt: r.createdAt,
  lines: lines.map((l) => ({ id: l.id, orderLineId: l.orderLineId, quantity: l.quantity })),
});

export const toEventDto = (e: OrderEvent): OrderEventDto => ({
  id: e.id,
  type: e.type,
  data: e.data,
  actorType: e.actorType,
  actorId: e.actorId ?? null,
  createdAt: e.createdAt,
});
