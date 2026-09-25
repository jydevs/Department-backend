import { Column, Entity, Index } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Entity("email_templates")
@Index(["key"], { unique: true })
export class EmailTemplate extends AppBaseEntity {
  /** order_confirmation | order_shipped | order_cancelled | password_reset | email_verify | welcome | refund_issued */
  @Column({ type: "varchar", length: 60 })
  key!: string;

  @Column({ type: "varchar", length: 255 })
  subject!: string;

  @Column({ type: "text" })
  bodyHtml!: string;

  @Column({ type: "text" })
  bodyText!: string;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;
}
