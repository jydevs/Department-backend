import { Check, Column, Entity, Index } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Check("chk_contact_messages_status", "\"status\" IN ('new','read','replied','spam')")
@Entity("contact_messages")
@Index(["status", "createdAt"])
export class ContactMessage extends AppBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "varchar", length: 200, nullable: true })
  subject?: string | null;

  @Column({ type: "varchar", length: 4000 })
  message!: string;

  @Column({ type: "varchar", length: 20, default: "new" })
  status!: string;

  /** Truncated (/24 or /48) for privacy. */
  @Column({ type: "varchar", length: 45, nullable: true })
  ip?: string | null;
}
