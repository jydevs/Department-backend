import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { moneyTransformer } from "../../common/money/money";
import { Order } from "./order.entity";

@Entity("payments")
@Index(["orderId"])
@Index(["reference"])
@Index(["provider", "providerTransactionId"], { unique: true, where: "\"provider_transaction_id\" IS NOT NULL" })
export class Payment extends AppBaseEntity {
  @Column({ type: "uuid" })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order?: Relation<Order>;

  @Column({ type: "varchar", length: 20 })
  provider!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  providerTransactionId?: string | null;

  @Column({ type: "varchar", length: 80 })
  reference!: string;

  @Column({ type: "bigint", transformer: moneyTransformer })
  amount!: number;

  @Column({ type: "varchar", length: 3, default: "COP" })
  currency!: string;

  @Column({ type: "varchar", length: 20, default: "pending" })
  status!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  rawStatus?: string | null;

  @Column({ type: "varchar", length: 30, nullable: true })
  method?: string | null;
}
