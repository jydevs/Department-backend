import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Order } from "./order.entity";

/**
 * Read-only access links sent by e-mail (confirmation, shipped, cancelled, refund). Only the sha256 of the token is stored.
 * Each e-mail gets its own token; it opens ONE order (GET /storefront/orders/:n?token=) with the same read/retry-payment
 * powers as the checkout token, and expires.
 */
@Entity("order_access_tokens")
@Index(["tokenHash"], { unique: true })
@Index(["orderId"])
export class OrderAccessToken extends AppBaseEntity {
  @Column({ type: "uuid" })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order?: Relation<Order>;

  @Column({ type: "varchar", length: 64 })
  tokenHash!: string;

  @Column({ type: "varchar", length: 20, default: "mail" })
  kind!: string;

  @Column({ type: "timestamptz", precision: 3 })
  expiresAt!: Date;
}
