import { Check, Column, Entity, Index } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Check("chk_email_outbox_status", "\"status\" IN ('pending','sent','failed')")
@Check("chk_email_outbox_attempts_nonneg", "\"attempts\" >= 0")
@Entity("email_outbox")
@Index(["status", "sendAfter"])
export class EmailOutbox extends AppBaseEntity {
  @Column({ type: "varchar", length: 255 })
  to!: string;

  @Column({ type: "varchar", length: 60 })
  template!: string;

  @Column({ type: "varchar", length: 255 })
  subject!: string;

  @Column({ type: "text" })
  bodyHtml!: string;

  @Column({ type: "text" })
  bodyText!: string;

  @Column({ type: "varchar", length: 20, default: "pending" })
  status!: string;

  @Column({ type: "integer", default: 0 })
  attempts!: number;

  @Column({ type: "text", nullable: true })
  lastError?: string | null;

  @Column({ type: "timestamptz", precision: 3, default: () => "now()" })
  sendAfter!: Date;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  sentAt?: Date | null;
}
