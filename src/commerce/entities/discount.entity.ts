import { Check, Column, Entity } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { moneyTransformer } from "../../common/money/money";

@Check("chk_discounts_used_count_nonneg", "\"used_count\" >= 0")
@Entity("discounts")
export class Discount extends AppBaseEntity {
  /** Stored UPPERCASE. */
  @Column({ type: "varchar", length: 40, unique: true })
  code!: string;

  @Column({ type: "varchar", length: 120 })
  title!: string;

  /** percent | fixed | free_shipping */
  @Column({ type: "varchar", length: 15 })
  type!: string;

  @Column({ type: "integer", default: 0 })
  value!: number;

  @Column({ type: "bigint", transformer: moneyTransformer, nullable: true })
  minSubtotal?: number | null;

  @Column({ type: "timestamptz", precision: 3 })
  startsAt!: Date;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  endsAt?: Date | null;

  @Column({ type: "integer", nullable: true })
  usageLimit?: number | null;

  @Column({ type: "integer", default: 0 })
  usedCount!: number;

  @Column({ type: "boolean", default: false })
  oncePerEmail!: boolean;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;
}
