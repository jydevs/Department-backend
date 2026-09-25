import { Column, Entity, Index } from "typeorm";
import { DeleteDateColumn, VersionedEntity } from "../../database/base.entity";

export type ContentKind = "settings" | "menu" | "template" | "page";

@Entity("content_documents")
@Index("uq_content_documents_kind_key", ["kind", "key"], { unique: true, where: '"deleted_at" IS NULL' })
export class ContentDocument extends VersionedEntity {
  @Column({ type: "varchar", length: 20 })
  kind!: ContentKind;

  @Column({ type: "varchar", length: 120 })
  key!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  title?: string | null;

  @Column({ type: "jsonb" })
  draft!: Record<string, unknown>;

  @Column({ type: "uuid", nullable: true })
  publishedVersionId?: string | null;

  @Column({ type: "timestamptz", precision: 3 })
  draftUpdatedAt!: Date;

  @Column({ type: "uuid", nullable: true })
  draftUpdatedBy?: string | null;

  @DeleteDateColumn({ type: "timestamptz", precision: 3, nullable: true })
  deletedAt?: Date | null;
}
