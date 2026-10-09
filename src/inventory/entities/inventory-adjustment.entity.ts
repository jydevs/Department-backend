import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";
import { v7 as uuidv7 } from "uuid";

@Entity("inventory_adjustments")
@Index(["variantId", "createdAt"])
export class InventoryAdjustment {
  @PrimaryColumn({ type: "uuid", default: () => "gen_random_uuid()" })
  id: string = uuidv7();

  @Column({ type: "uuid" })
  variantId!: string;

  @Column({ type: "uuid" })
  locationId!: string;

  @Column({ type: "integer" })
  delta!: number;

  @Column({ type: "varchar", length: 20 })
  reason!: string;

  @Column({ type: "text", nullable: true })
  note?: string | null;

  @Column({ type: "uuid", nullable: true })
  actorId?: string | null;

  @CreateDateColumn({ type: "timestamptz", precision: 3 })
  createdAt!: Date;
}
