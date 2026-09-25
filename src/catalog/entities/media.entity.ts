import { Column, Entity, Index } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Entity("media")
@Index("uq_media_sha256", ["sha256"], { unique: true, where: '"sha256" IS NOT NULL' })
export class Media extends AppBaseEntity {
  @Column({ type: "text" })
  url!: string;

  @Column({ type: "text", nullable: true })
  alt?: string | null;

  @Column({ type: "integer", nullable: true })
  width?: number | null;

  @Column({ type: "integer", nullable: true })
  height?: number | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  mimeType?: string | null;

  /** Key inside the storage driver (never derived from the client file name). Null for legacy URL-only media. */
  @Column({ type: "varchar", length: 255, nullable: true })
  storageKey?: string | null;

  @Column({ type: "integer", nullable: true })
  byteSize?: number | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  originalName?: string | null;

  @Column({ type: "char", length: 64, nullable: true })
  sha256?: string | null;

  @Column({ type: "uuid", nullable: true })
  uploadedBy?: string | null;
}
