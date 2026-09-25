import {
  Column,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  Relation,
} from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { StaffUser } from "./staff-user.entity";

@Entity("refresh_tokens")
@Index(["staffUserId"])
@Index(["familyId"])
@Index(["tokenHash"])
export class RefreshToken extends AppBaseEntity {
  @Column({ type: "uuid" })
  staffUserId!: string;

  @ManyToOne(() => StaffUser, (user) => user.refreshTokens, { onDelete: "CASCADE" })
  @JoinColumn({ name: "staff_user_id" })
  staffUser?: Relation<StaffUser>;

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
