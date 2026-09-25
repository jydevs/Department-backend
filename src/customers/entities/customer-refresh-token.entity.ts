import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Customer } from "./customer.entity";

@Entity("customer_refresh_tokens")
@Index(["customerId"])
@Index(["familyId"])
export class CustomerRefreshToken extends AppBaseEntity {
  @Column({ type: "uuid" })
  customerId!: string;

  @ManyToOne(() => Customer, (c) => c.refreshTokens, { onDelete: "CASCADE" })
  @JoinColumn({ name: "customer_id" })
  customer?: Relation<Customer>;

  @Column({ type: "uuid" })
  familyId!: string;

  @Column({ type: "char", length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: "timestamptz", precision: 3 })
  expiresAt!: Date;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  revokedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  replacedById?: string | null;

  @Column({ type: "varchar", length: 300, nullable: true })
  userAgent?: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  ip?: string | null;
}
