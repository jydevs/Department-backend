import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { VersionedEntity } from "../../database/base.entity";
import { Variant } from "../../catalog/entities/variant.entity";
import { Location } from "./location.entity";

@Check("chk_inventory_on_hand_nonneg", "\"on_hand\" >= 0")
@Check("chk_inventory_reserved_range", "\"reserved\" >= 0 AND \"reserved\" <= \"on_hand\"")
@Entity("inventory_levels")
@Index(["variantId"])
@Index(["locationId"])
@Index(["variantId", "locationId"], { unique: true })
export class InventoryLevel extends VersionedEntity {
  @Column({ type: "uuid" })
  variantId!: string;

  @ManyToOne(() => Variant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "variant_id" })
  variant?: Relation<Variant>;

  @Column({ type: "uuid" })
  locationId!: string;

  @ManyToOne(() => Location, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "location_id" })
  location?: Relation<Location>;

  @Column({ type: "integer", default: 0 })
  onHand!: number;

  @Column({ type: "integer", default: 0 })
  reserved!: number;
}

/**
 * NOTE: CHECK constraints (onHand >= 0) and (reserved >= 0 AND reserved <= onHand)
 * are created in migration, not via decorator
 */
