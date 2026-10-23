import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  Relation,
  JoinColumn,
} from "typeorm";
import { VersionedEntity } from "../../database/base.entity";
import { Role } from "./role.entity";
import { RefreshToken } from "./refresh-token.entity";

@Entity("staff_users")
@Index(["email"], { unique: true })
@Index(["roleId"])
export class StaffUser extends VersionedEntity {
  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "text" })
  passwordHash!: string;

  @Column({ type: "varchar", length: 255 })
  fullName!: string;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "uuid" })
  roleId!: string;

  @ManyToOne(() => Role)
  @JoinColumn({ name: "role_id" })
  role?: Relation<Role>;

  @Column({ type: "text", nullable: true })
  totpSecretEnc?: string | null;

  @Column({ type: "boolean", default: false })
  totpEnabled!: boolean;

  /** Last accepted TOTP time step: codes of that step or older are rejected (no replay inside the 30 s window). */
  @Column({ type: "integer", nullable: true })
  totpLastStep?: number | null;

  @Column({ type: "text", array: true, default: "{}" })
  recoveryCodesHash!: string[];

  /** When the pending (unconfirmed) totpSecretEnc was issued; null once 2FA is enabled or disabled. */
  @Column({ type: "timestamptz", precision: 3, nullable: true })
  totpSetupAt?: Date | null;

  /** Temporary password (team invite / owner bootstrap): the session may only change the password until it does. */
  @Column({ type: "boolean", default: false })
  mustChangePassword!: boolean;

  /** @deprecated login failures are counted per (account, IP) in login_attempts; kept for old data. */
  @Column({ type: "integer", default: 0 })
  failedLoginCount!: number;

  /** @deprecated see failedLoginCount. */
  @Column({ type: "timestamptz", precision: 3, nullable: true })
  lockedUntil?: Date | null;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  lastLoginAt?: Date | null;

  @OneToMany(() => RefreshToken, (token) => token.staffUser)
  refreshTokens?: Relation<RefreshToken[]>;
}
