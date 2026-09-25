import { Check, Column, Entity, Index } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Check("chk_newsletter_status", "\"status\" IN ('pending','subscribed','unsubscribed')")
@Entity("newsletter_subscribers")
@Index(["email"], { unique: true })
@Index(["status"])
@Index(["confirmTokenHash"])
@Index(["unsubscribeTokenHash"])
export class NewsletterSubscriber extends AppBaseEntity {
  /** Stored lowercase (enforced by the service). */
  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "varchar", length: 20, default: "pending" })
  status!: string;

  @Column({ type: "varchar", length: 40 })
  source!: string;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  consentAt?: Date | null;

  @Column({ type: "char", length: 64, nullable: true })
  confirmTokenHash?: string | null;

  @Column({ type: "char", length: 64, nullable: true })
  unsubscribeTokenHash?: string | null;

  /** Truncated (/24 or /48) for privacy. */
  @Column({ type: "varchar", length: 45, nullable: true })
  ip?: string | null;
}
