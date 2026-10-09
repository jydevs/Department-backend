import { Check, Column, Entity, Index, OneToMany, Relation } from "typeorm";
import { VersionedEntity } from "../../database/base.entity";
import { moneyTransformer } from "../../common/money/money";
import type { Address } from "../common/address.schema";
import type { OrderLine } from "./order-line.entity";
import type { OrderEvent } from "./order-event.entity";
import type { Payment } from "./payment.entity";
import type { Fulfillment } from "./fulfillment.entity";
import type { Refund } from "./refund.entity";

@Check(
  "chk_orders_amounts_nonneg",
  "\"subtotal\" >= 0 AND \"discount_total\" >= 0 AND \"shipping_total\" >= 0 AND \"tax_total\" >= 0 AND \"total\" >= 0",
)
@Check("chk_orders_total_refunded", "\"total_refunded\" BETWEEN 0 AND \"total\"")
@Entity("orders")
@Index(["status", "createdAt"])
@Index(["email"])
@Index(["paymentStatus"])
@Index(["customerId"])
@Index(["paidAt"])
export class Order extends VersionedEntity {
  @Column({ type: "int", unique: true, default: () => "nextval('order_number_seq')" })
  orderNumber!: number;

  @Column({ type: "char", length: 64 })
  accessTokenHash!: string;

  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "varchar", length: 30, nullable: true })
  phone?: string | null;

  @Column({ type: "varchar", length: 20, default: "pending" })
  status!: string;

  @Column({ type: "varchar", length: 20, default: "pending" })
  paymentStatus!: string;

  @Column({ type: "varchar", length: 20, default: "unfulfilled" })
  fulfillmentStatus!: string;

  @Column({ type: "varchar", length: 3, default: "COP" })
  currency!: string;

  @Column({ type: "bigint", transformer: moneyTransformer })
  subtotal!: number;

  @Column({ type: "bigint", transformer: moneyTransformer, default: 0 })
  discountTotal!: number;

  @Column({ type: "bigint", transformer: moneyTransformer, default: 0 })
  shippingTotal!: number;

  @Column({ type: "bigint", transformer: moneyTransformer, default: 0 })
  taxTotal!: number;

  @Column({ type: "bigint", transformer: moneyTransformer })
  total!: number;

  @Column({ type: "bigint", transformer: moneyTransformer, default: 0 })
  totalRefunded!: number;

  @Column({ type: "varchar", length: 40, nullable: true })
  discountCode?: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  shippingRateName?: string | null;

  @Column({ type: "jsonb" })
  shippingAddress!: Address;

  @Column({ type: "jsonb", nullable: true })
  billingAddress?: Address | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  customerNote?: string | null;

  @Column({ type: "text", nullable: true })
  internalNote?: string | null;

  @Column({ type: "text", array: true, default: () => "'{}'" })
  tags!: string[];

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  reservedUntil?: Date | null;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  paidAt?: Date | null;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  cancelledAt?: Date | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  cancelReason?: string | null;

  /** Phase 5 link; intentionally no FK yet. */
  @Column({ type: "uuid", nullable: true })
  customerId?: string | null;

  @Column({ type: "varchar", length: 20 })
  paymentProvider!: string;

  @Column({ type: "varchar", length: 80, unique: true })
  paymentReference!: string;

  @Column({ type: "uuid", nullable: true })
  idempotencyKeyId?: string | null;

  @OneToMany("OrderLine", (l: OrderLine) => l.order)
  lines?: Relation<OrderLine[]>;

  @OneToMany("Payment", (p: Payment) => p.order)
  payments?: Relation<Payment[]>;

  @OneToMany("Fulfillment", (f: Fulfillment) => f.order)
  fulfillments?: Relation<Fulfillment[]>;

  @OneToMany("Refund", (r: Refund) => r.order)
  refunds?: Relation<Refund[]>;

  @OneToMany("OrderEvent", (e: OrderEvent) => e.order)
  events?: Relation<OrderEvent[]>;
}
