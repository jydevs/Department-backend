import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { moneyTransformer } from "../../common/money/money";
import { Order } from "./order.entity";
import type { RefundLine } from "./refund-line.entity";

@Check("chk_refunds_amount_positive", "\"amount\" > 0")
@Entity("refunds")
@Index(["orderId"])
export class Refund extends AppBaseEntity {
  @Column({ type: "uuid" })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order?: Relation<Order>;

  @Column({ type: "bigint", transformer: moneyTransformer })
  amount!: number;

  @Column({ type: "varchar", length: 255, nullable: true })
  reason?: string | null;

  @Column({ type: "boolean", default: false })
  restocked!: boolean;

  @Column({ type: "varchar", length: 20, default: "manual" })
  providerStatus!: string;

  @Column({ type: "uuid", nullable: true })
  actorId?: string | null;

  @OneToMany("RefundLine", (l: RefundLine) => l.refund)
  lines?: Relation<RefundLine[]>;
}
