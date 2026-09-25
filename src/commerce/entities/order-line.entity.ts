import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { moneyTransformer } from "../../common/money/money";
import { Order } from "./order.entity";

@Entity("order_lines")
@Index(["orderId"])
export class OrderLine extends AppBaseEntity {
  @Column({ type: "uuid" })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order?: Relation<Order>;

  /** Snapshot reference; no FK because the variant may be deactivated later. */
  @Column({ type: "uuid" })
  variantId!: string;

  @Column({ type: "uuid" })
  productId!: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  sku?: string | null;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "varchar", length: 255 })
  variantTitle!: string;

  @Column({ type: "varchar", length: 1000, nullable: true })
  imageUrl?: string | null;

  @Column({ type: "bigint", transformer: moneyTransformer })
  unitPrice!: number;

  @Column({ type: "integer" })
  quantity!: number;

  @Column({ type: "bigint", transformer: moneyTransformer })
  lineTotal!: number;

  @Column({ type: "integer", default: 0 })
  fulfilledQuantity!: number;

  @Column({ type: "integer", default: 0 })
  refundedQuantity!: number;
}
