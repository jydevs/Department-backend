import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { moneyTransformer } from "../../common/money/money";
import { Discount } from "./discount.entity";
import { Order } from "./order.entity";

@Entity("discount_redemptions")
@Index(["discountId", "orderId"], { unique: true })
@Index(["discountId", "email"])
export class DiscountRedemption extends AppBaseEntity {
  @Column({ type: "uuid" })
  discountId!: string;

  @ManyToOne(() => Discount, { onDelete: "CASCADE" })
  @JoinColumn({ name: "discount_id" })
  discount?: Relation<Discount>;

  @Column({ type: "uuid" })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order?: Relation<Order>;

  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "bigint", transformer: moneyTransformer })
  amount!: number;
}
