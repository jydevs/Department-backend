import { Column, Entity, Index } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Entity("idempotency_keys")
@Index(["scope", "key"], { unique: true })
export class IdempotencyKey extends AppBaseEntity {
  @Column({ type: "varchar", length: 40 })
  scope!: string;

  @Column({ type: "varchar", length: 120 })
  key!: string;

  @Column({ type: "char", length: 64 })
  requestHash!: string;

  /** in_progress | done */
  @Column({ type: "varchar", length: 12, default: "in_progress" })
  status!: string;

  @Column({ type: "integer", nullable: true })
  responseStatus?: number | null;

  @Column({ type: "jsonb", nullable: true })
  response?: unknown | null;
}
