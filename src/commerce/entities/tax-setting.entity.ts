import { Column, Entity } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

/** Single-row table. pg returns numeric as string; ratePercent is kept as such. */
@Entity("tax_settings")
export class TaxSetting extends AppBaseEntity {
  @Column({ type: "boolean", default: true })
  pricesIncludeTax!: boolean;

  @Column({ type: "numeric", precision: 5, scale: 2, default: "19.00" })
  ratePercent!: string;

  @Column({ type: "varchar", length: 40, default: "IVA" })
  label!: string;
}
