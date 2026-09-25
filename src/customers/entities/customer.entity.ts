import { Column, DeleteDateColumn, Entity, Index, OneToMany, Relation } from "typeorm";
import { VersionedEntity } from "../../database/base.entity";
import type { CustomerAddress } from "./customer-address.entity";
import type { CustomerRefreshToken } from "./customer-refresh-token.entity";
import type { CustomerToken } from "./customer-token.entity";

@Entity("customers")
@Index(["email"], { unique: true })
@Index(["acceptsMarketing"])
@Index(["createdAt"])
export class Customer extends VersionedEntity {
  /** Stored lowercase (enforced by the service). */
  @Column({ type: "varchar", length: 255 })
  email!: string;

  /** null = guest customer without an account. */
  @Column({ type: "text", nullable: true })
  passwordHash?: string | null;

  @Column({ type: "varchar", length: 120 })
  firstName!: string;

  @Column({ type: "varchar", length: 120 })
  lastName!: string;

  @Column({ type: "varchar", length: 30, nullable: true })
  phone?: string | null;

  @Column({ type: "boolean", default: false })
  acceptsMarketing!: boolean;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  marketingConsentAt?: Date | null;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  emailVerifiedAt?: Date | null;

  @Column({ type: "integer", default: 0 })
  failedLoginCount!: number;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  lockedUntil?: Date | null;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  lastLoginAt?: Date | null;

  @Column({ type: "text", array: true, default: () => "'{}'" })
  tags!: string[];

  @Column({ type: "text", nullable: true })
  internalNote?: string | null;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  anonymizedAt?: Date | null;

  @DeleteDateColumn({ type: "timestamptz", precision: 3 })
  deletedAt?: Date | null;

  @OneToMany("CustomerAddress", (a: CustomerAddress) => a.customer)
  addresses?: Relation<CustomerAddress[]>;

  @OneToMany("CustomerRefreshToken", (t: CustomerRefreshToken) => t.customer)
  refreshTokens?: Relation<CustomerRefreshToken[]>;

  @OneToMany("CustomerToken", (t: CustomerToken) => t.customer)
  tokens?: Relation<CustomerToken[]>;
}
