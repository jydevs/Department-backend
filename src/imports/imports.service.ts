import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { Repository } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { AuditService } from "../audit/audit.service";
import { Clock } from "../common/clock/clock";
import { AppException } from "../common/errors/app-exception";
import { OffsetPage, toOffsetPage } from "../common/pagination/pagination";
import { firstRow } from "../common/sql/query-result";
import { ImportFileStorage, importFileKey } from "./import-file.storage";
import { ImportJob, type ImportType } from "./entities/import-job.entity";
import type { ImportJobDetailDto, ImportJobSummaryDto, ListImportsQueryDto } from "./imports.dto";
import { MAX_FILE_BYTES } from "./imports.types";

export interface UploadedCsv {
  buffer: Buffer;
  originalname: string;
}

/** True when the bytes are UTF-8 text (optional BOM) with no NUL bytes: rejects images, zips, spreadsheets, UTF-16. */
export function looksLikeUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/** Client file names are only a label: keep the base name, drop control characters, cap the length. */
function safeFileName(name: string): string {
  const printable = [...name].filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join("");
  const base = path.basename(printable.replace(/\\/g, "/")).trim();
  return (base || "import.csv").slice(-255);
}

@Injectable()
export class ImportsService {
  constructor(
    @InjectRepository(ImportJob) private readonly repo: Repository<ImportJob>,
    private readonly files: ImportFileStorage,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Stores the CSV privately and queues the job. Nothing is parsed here: the worker does it. */
  async create(file: UploadedCsv | undefined, type: ImportType, dryRun: boolean, actorId: string | null): Promise<ImportJobSummaryDto> {
    if (!file || file.buffer.length === 0) throw AppException.badRequest("VALIDATION_ERROR", "A CSV file is required in the 'file' field");
    if (file.buffer.length > MAX_FILE_BYTES) throw new AppException(413, "PAYLOAD_TOO_LARGE", "The file exceeds 10 MB");
    if (!/\.csv$/i.test(file.originalname) || !looksLikeUtf8Text(file.buffer)) {
      throw new AppException(415, "UNSUPPORTED_MEDIA_TYPE", "Only UTF-8 CSV text files (.csv) are accepted");
    }

    const job = new ImportJob();
    job.id = uuidv7();
    job.type = type;
    job.status = "queued";
    job.dryRun = dryRun;
    job.fileName = safeFileName(file.originalname);
    job.fileSha256 = createHash("sha256").update(file.buffer).digest("hex");
    job.errors = [];
    job.createdBy = actorId;

    const key = importFileKey(job.id);
    await this.files.put(key, file.buffer);
    try {
      await this.repo.save(job);
    } catch (err) {
      await this.files.delete(key).catch(() => undefined);
      throw err;
    }
    await this.audit.record({ action: "import:create", entityType: "ImportJob", entityId: job.id, diff: { type, dryRun, sha256: job.fileSha256 } });
    return this.toSummary(job);
  }

  async list(q: ListImportsQueryDto): Promise<OffsetPage<ImportJobSummaryDto>> {
    const qb = this.repo.createQueryBuilder("j").orderBy("j.created_at", "DESC").addOrderBy("j.id", "DESC");
    if (q.status) qb.andWhere("j.status = :status", { status: q.status });
    if (q.type) qb.andWhere("j.type = :type", { type: q.type });
    const [rows, total] = await qb
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return toOffsetPage(rows.map((r) => this.toSummary(r)), total, q.page, q.pageSize);
  }

  async get(id: string): Promise<ImportJobDetailDto> {
    const job = await this.repo.findOne({ where: { id } });
    if (!job) throw AppException.notFound("Import job");
    return { ...this.toSummary(job), errors: job.errors, errorsTruncated: job.errorCount > job.errors.length };
  }

  /** queued -> cancelled at once; running -> the worker stops before its next batch (rows already written stay). */
  async cancel(id: string): Promise<ImportJobSummaryDto> {
    const res = await this.repo.query(
      `UPDATE import_jobs SET status = 'cancelled', finished_at = $2, updated_at = $2, version = version + 1
        WHERE id = $1 AND status IN ('queued', 'running') RETURNING id`,
      [id, this.clock.now()],
    );
    if (!firstRow<{ id: string }>(res)) {
      const exists = await this.repo.exists({ where: { id } });
      if (!exists) throw AppException.notFound("Import job");
      throw AppException.conflict("IMPORT_NOT_CANCELLABLE", "Only queued or running jobs can be cancelled");
    }
    await this.files.delete(importFileKey(id)).catch(() => undefined); // the worker holds its own copy in memory
    await this.audit.record({ action: "import:cancel", entityType: "ImportJob", entityId: id });
    const job = await this.repo.findOneOrFail({ where: { id } });
    return this.toSummary(job);
  }

  private toSummary(j: ImportJob): ImportJobSummaryDto {
    const done = j.status === "done";
    return {
      id: j.id,
      type: j.type,
      status: j.status,
      dryRun: j.dryRun,
      fileName: j.fileName,
      fileSha256: j.fileSha256,
      totalRows: j.totalRows,
      processedRows: j.processedRows,
      progressPercent: done ? 100 : j.totalRows > 0 ? Math.min(100, Math.floor((j.processedRows / j.totalRows) * 100)) : 0,
      createdCount: j.createdCount,
      updatedCount: j.updatedCount,
      skippedCount: j.skippedCount,
      errorCount: j.errorCount,
      startedAt: j.startedAt ?? null,
      finishedAt: j.finishedAt ?? null,
      createdBy: j.createdBy ?? null,
      createdAt: j.createdAt,
    };
  }
}
