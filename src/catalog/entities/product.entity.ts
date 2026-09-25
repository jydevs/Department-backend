import { Column, Entity, Index } from "typeorm";
import { DeleteDateColumn, VersionedEntity } from "../../database/base.entity";

/**
 * NOTE: GIN index on tags[] is created in migration, not via decorator
 */

@Entity("products")
@Index(["status"])
@Index(["status", "publishedAt"])
export class Product extends VersionedEntity {
  @Column({ type: "varchar", length: 120, unique: true })
  handle!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text", default: "" })
  descriptionHtml!: string;

  @Column({ type: "varchar", length: 12, default: "draft" })
  status!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  vendor?: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  productType?: string | null;

  @Column({ type: "text", array: true, default: "{}" })
  tags!: string[];

  @Column({ type: "varchar", length: 255, nullable: true })
  seoTitle?: string | null;

  @Column({ type: "text", nullable: true })
  seoDescription?: string | null;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  publishedAt?: Date | null;

  @DeleteDateColumn({ type: "timestamptz", precision: 3, nullable: true })
  deletedAt?: Date | null;
}
