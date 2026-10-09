import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { moneyTransformer } from "../../common/money/money";
import { Order } from "./order.entity";

@Check("chk_order_lines_quantity", "\"quantity\" > 0")
@Check("chk_order_lines_fulfilled", "\"fulfilled_quantity\" <= \"quantity\"")
@Check("chk_order_lines_refunded", "\"refunded_quantity\" <= \"quantity\"")
@Check("chk_order_lines_reserved", "\"reserved_quantity\" BETWEEN 0 AND \"quantity\"")
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

  @Column({ type: "varchar", length: 120, nullable: true })
  sku?: string | null;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "varchar", length: 255 })
  variantTitle!: string;

  @Column({ type: "varchar", length: 2000, nullable: true })
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

  /** Units actually reserved in inventory at checkout (0 for untracked / backorderable variants); drives commit/release. */
  @Column({ type: "integer", default: 0 })
  reservedQuantity!: number;
}
