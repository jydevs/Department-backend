import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Customer } from "./customer.entity";

/** One-time tokens: password reset (1 h) and email verification (48 h). */
@Check("chk_customer_tokens_type", "\"type\" IN ('password_reset','email_verify')")
@Entity("customer_tokens")
@Index(["customerId", "type"])
export class CustomerToken extends AppBaseEntity {
  @Column({ type: "uuid" })
  customerId!: string;

  @ManyToOne(() => Customer, (c) => c.tokens, { onDelete: "CASCADE" })
  @JoinColumn({ name: "customer_id" })
  customer?: Relation<Customer>;

  @Column({ type: "varchar", length: 20 })
  type!: string;

  @Column({ type: "char", length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: "timestamptz", precision: 3 })
  expiresAt!: Date;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  usedAt?: Date | null;
}
