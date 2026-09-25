import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { ContentDocument } from "./content-document.entity";

export type ContentVersionStatus = "published" | "scheduled" | "superseded" | "cancelled";

@Entity("content_versions")
@Check("chk_content_versions_status", "\"status\" IN ('published','scheduled','superseded','cancelled')")
@Index("uq_content_versions_document_number", ["documentId", "number"], { unique: true })
@Index("idx_content_versions_scheduled", ["publishAt"], { where: "\"status\" = 'scheduled'" })
export class ContentVersion {
  @PrimaryColumn({ type: "uuid", default: () => "gen_random_uuid()" }) // DB fallback; entities built with new/create() get a v7
  id: string = uuidv7();

  @Column({ type: "uuid" })
  documentId!: string;

  @ManyToOne(() => ContentDocument, { onDelete: "CASCADE" })
  @JoinColumn({ name: "document_id" })
  document?: Relation<ContentDocument>;

  @Column({ type: "integer" })
  number!: number;

  /** Title of the document at the time this version was captured (pages use `data.title` instead). */
  @Column({ type: "varchar", length: 255, nullable: true })
  title?: string | null;

  @Column({ type: "jsonb" })
  data!: Record<string, unknown>;

  @Column({ type: "varchar", length: 12 })
  status!: ContentVersionStatus;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  publishAt?: Date | null;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  publishedAt?: Date | null;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  supersededAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  authorId?: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  note?: string | null;

  @CreateDateColumn({ type: "timestamptz", precision: 3 })
  createdAt!: Date;
}
