import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { Order } from "./order.entity";

/** Append-only timeline; no updatedAt. */
@Entity("order_events")
@Index(["orderId", "createdAt"])
export class OrderEvent {
  @PrimaryColumn({ type: "uuid", default: () => "gen_random_uuid()" }) // DB fallback for plain-object inserts; entities built with new/create() get a v7
  id: string = uuidv7();

  @Column({ type: "uuid" })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order?: Relation<Order>;

  @Column({ type: "varchar", length: 40 })
  type!: string;

  @Column({ type: "jsonb", default: () => "'{}'" })
  data!: Record<string, unknown>;

  @Column({ type: "varchar", length: 20 })
  actorType!: string;

  @Column({ type: "uuid", nullable: true })
  actorId?: string | null;

  @CreateDateColumn({ type: "timestamptz", precision: 3 })
  createdAt!: Date;
}
