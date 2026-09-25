import { Check, Column, Entity, Index } from "typeorm";
import { VersionedEntity } from "../../database/base.entity";

export const IMPORT_TYPES = ["products", "customers"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Max stored per job; `errorCount` keeps counting past it. */
export const MAX_STORED_ERRORS = 200;

export interface ImportRowError {
  /** 1-based CSV line (header = line 1); 0 = file-level error. */
  row: number;
  code: string;
  message: string;
}

@Check("chk_import_jobs_status", "\"status\" IN ('queued','running','done','failed','cancelled')")
@Check("chk_import_jobs_type", "\"type\" IN ('products','customers')")
@Entity("import_jobs")
@Index("idx_import_jobs_status_created", ["status", "createdAt"])
export class ImportJob extends VersionedEntity {
  @Column({ type: "varchar", length: 20 })
  type!: ImportType;

  @Column({ type: "varchar", length: 20, default: "queued" })
  status!: ImportStatus;

  @Column({ type: "boolean", default: false })
  dryRun!: boolean;

  @Column({ type: "varchar", length: 255 })
  fileName!: string;

  @Column({ type: "char", length: 64 })
  fileSha256!: string;

  @Column({ type: "integer", default: 0 })
  totalRows!: number;

  @Column({ type: "integer", default: 0 })
  processedRows!: number;

  @Column({ type: "integer", default: 0 })
  createdCount!: number;

  @Column({ type: "integer", default: 0 })
  updatedCount!: number;

  @Column({ type: "integer", default: 0 })
  skippedCount!: number;

  @Column({ type: "integer", default: 0 })
  errorCount!: number;

  @Column({ type: "jsonb", default: () => "'[]'" })
  errors!: ImportRowError[];

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  startedAt?: Date | null;

  @Column({ type: "timestamptz", precision: 3, nullable: true })
  finishedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  createdBy?: string | null;
}
