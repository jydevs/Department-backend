import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { VersionedEntity } from "../../database/base.entity";
import { Product } from "./product.entity";
import { moneyTransformer } from "../../common/money/money";

@Check("chk_variants_price_nonneg", "\"price\" >= 0")
@Entity("variants")
@Index(["productId"])
@Index(["sku"], { unique: true, where: '"sku" IS NOT NULL' })
export class Variant extends VersionedEntity {
  @Column({ type: "uuid" })
  productId!: string;

  @ManyToOne(() => Product, (product) => product.variants, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product?: Relation<Product>;

  @Column({ type: "varchar", length: 120, nullable: true })
  sku?: string | null;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "bigint", transformer: moneyTransformer })
  price!: number;

  @Column({ type: "bigint", transformer: moneyTransformer, nullable: true })
  compareAtPrice?: number | null;

  @Column({ type: "integer", nullable: true })
  weightGrams?: number | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  barcode?: string | null;

  @Column({ type: "integer" })
  position!: number;

  @Column({ type: "boolean", default: true })
  trackInventory!: boolean;

  @Column({ type: "boolean", default: false })
  allowBackorder!: boolean;

  @Column({ type: "uuid", array: true, default: "{}" })
  optionValueIds!: string[];

  @Column({ type: "boolean", default: true })
  isActive!: boolean;
}

/**
 * NOTE: CHECK constraint (price >= 0) is created in migration, not via decorator
 */
