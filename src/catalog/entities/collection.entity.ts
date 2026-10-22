import { Column, Entity, Index } from "typeorm";
import { VersionedEntity, DeleteDateColumn } from "../../database/base.entity";

@Entity("collections")
@Index(["handle"], { unique: true })
@Index(["isPublished"])
export class Collection extends VersionedEntity {
  @Column({ type: "varchar", length: 120, unique: true })
  handle!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text", default: "" })
  descriptionHtml!: string;

  @Column({ type: "varchar", length: 8 })
  type!: string; // 'manual' | 'smart'

  @Column({ type: "jsonb", nullable: true })
  rules?: unknown | null;

  @Column({ type: "varchar", length: 12, default: "manual" })
  sortOrder!: string;

  @Column({ type: "boolean", default: false })
  isPublished!: boolean;

  @Column({ type: "varchar", length: 255, nullable: true })
  seoTitle?: string | null;

  @Column({ type: "text", nullable: true })
  seoDescription?: string | null;

  @Column({ type: "uuid", nullable: true })
  imageMediaId?: string | null;

  @DeleteDateColumn({ type: "timestamptz", precision: 3, nullable: true })
  deletedAt?: Date | null;
}
