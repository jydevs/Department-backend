import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { moneyTransformer } from "../../common/money/money";
import { ShippingZone } from "./shipping-zone.entity";

@Check("chk_shipping_rates_price", "\"price\" >= 0")
@Entity("shipping_rates")
@Index(["zoneId", "position"])
export class ShippingRate extends AppBaseEntity {
  @Column({ type: "uuid" })
  zoneId!: string;

  @ManyToOne(() => ShippingZone, { onDelete: "CASCADE" })
  @JoinColumn({ name: "zone_id" })
  zone?: Relation<ShippingZone>;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "bigint", transformer: moneyTransformer })
  price!: number;

  @Column({ type: "bigint", transformer: moneyTransformer, nullable: true })
  freeOverSubtotal?: number | null;

  @Column({ type: "integer", nullable: true })
  minDays?: number | null;

  @Column({ type: "integer", nullable: true })
  maxDays?: number | null;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "integer", default: 0 })
  position!: number;
}
