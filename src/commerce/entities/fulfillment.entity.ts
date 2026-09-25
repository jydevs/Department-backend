import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Order } from "./order.entity";
import type { FulfillmentLine } from "./fulfillment-line.entity";

@Entity("fulfillments")
@Index(["orderId"])
export class Fulfillment extends AppBaseEntity {
  @Column({ type: "uuid" })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order?: Relation<Order>;

  @Column({ type: "varchar", length: 20, default: "success" })
  status!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  carrier?: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  trackingNumber?: string | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  trackingUrl?: string | null;

  @Column({ type: "timestamptz", precision: 3 })
  shippedAt!: Date;

  @OneToMany("FulfillmentLine", (l: FulfillmentLine) => l.fulfillment)
  lines?: Relation<FulfillmentLine[]>;
}
