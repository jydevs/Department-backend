import { Column, Entity, OneToMany, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import type { ShippingRate } from "./shipping-rate.entity";

@Entity("shipping_zones")
export class ShippingZone extends AppBaseEntity {
  @Column({ type: "varchar", length: 120, unique: true })
  name!: string;

  /** DANE codes or normalized names; "*" = whole country. */
  @Column({ type: "text", array: true, default: () => "'{}'" })
  departments!: string[];

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @OneToMany("ShippingRate", (r: ShippingRate) => r.zone)
  rates?: Relation<ShippingRate[]>;
}
