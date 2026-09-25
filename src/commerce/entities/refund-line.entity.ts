import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Refund } from "./refund.entity";
import { OrderLine } from "./order-line.entity";

@Check("chk_refund_lines_quantity", "\"quantity\" > 0")
@Entity("refund_lines")
@Index(["refundId"])
@Index(["orderLineId"])
export class RefundLine extends AppBaseEntity {
  @Column({ type: "uuid" })
  refundId!: string;

  @ManyToOne(() => Refund, { onDelete: "CASCADE" })
  @JoinColumn({ name: "refund_id" })
  refund?: Relation<Refund>;

  @Column({ type: "uuid" })
  orderLineId!: string;

  @ManyToOne(() => OrderLine, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_line_id" })
  orderLine?: Relation<OrderLine>;

  @Column({ type: "integer" })
  quantity!: number;
}
