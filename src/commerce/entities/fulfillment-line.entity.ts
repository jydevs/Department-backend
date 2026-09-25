import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Fulfillment } from "./fulfillment.entity";
import { OrderLine } from "./order-line.entity";

@Check("chk_fulfillment_lines_quantity", "\"quantity\" > 0")
@Entity("fulfillment_lines")
@Index(["fulfillmentId"])
@Index(["orderLineId"])
export class FulfillmentLine extends AppBaseEntity {
  @Column({ type: "uuid" })
  fulfillmentId!: string;

  @ManyToOne(() => Fulfillment, { onDelete: "CASCADE" })
  @JoinColumn({ name: "fulfillment_id" })
  fulfillment?: Relation<Fulfillment>;

  @Column({ type: "uuid" })
  orderLineId!: string;

  @ManyToOne(() => OrderLine, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_line_id" })
  orderLine?: Relation<OrderLine>;

  @Column({ type: "integer" })
  quantity!: number;
}
