import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { VersionedEntity } from "../../database/base.entity";
import { Variant } from "../../catalog/entities/variant.entity";
import { Location } from "./location.entity";

@Check("chk_inventory_reserved_range", "\"reserved\" >= 0 AND \"reserved\" <= GREATEST(\"on_hand\", 0)")
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
 * NOTE: on_hand may be negative only for variants that track inventory AND allow backorder (see InventoryService.commitBackordered);
 * the CHECK (reserved >= 0 AND reserved <= GREATEST(on_hand, 0)) is created in migration, not via decorator
 */
