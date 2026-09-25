import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { AuditService } from "../audit/audit.service";
import { Clock } from "../common/clock/clock";
import { firstRow, rowsOf } from "../common/sql/query-result";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { TransactionService } from "../database/transaction.service";
import { CsvFormatError, readCsv } from "./csv-reader";
import { CustomerImporter } from "./customer-importer";
import { ImportFileStorage, importFileKey } from "./import-file.storage";
import { ImportJob, MAX_STORED_ERRORS, type ImportRowError } from "./entities/import-job.entity";
import { BATCH_SIZE, type BatchOutcome, type Importer, type ImportUnit } from "./imports.types";
import { ProductImporter } from "./product-importer";

const INTERVAL_MS = 5_000;
/** A `running` job that has not reported progress for this long lost its worker (crash / deploy). */
const STALE_MS = 15 * 60 * 1000;
const MAX_JOBS_PER_TICK = 5;

/** Thrown at the end of a dry-run batch to roll its transaction back; carries the batch result. */
class DryRunRollback extends Error {
  constructor(readonly outcome: BatchOutcome) {
    super("dry-run rollback");
  }
}

interface JobState {
  totalRows: number;
  processedRows: number;
  created: number;
  updated: number;
  skipped: number;
  errorCount: number;
  errors: ImportRowError[];
}

/**
 * In-process CSV import worker. One job at a time per instance; several instances are safe because a job is
 * claimed with `FOR UPDATE SKIP LOCKED`. Batches of 50 rows, each in its own transaction (dry-run: rolled back).
 */
@Injectable()
export class ImportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(ImportJob) private readonly repo: Repository<ImportJob>,
    private readonly dataSource: DataSource,
    private readonly tx: TransactionService,
    private readonly files: ImportFileStorage,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly products: ProductImporter,
    private readonly customers: CustomerImporter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === "test" && process.env.IMPORT_WORKER_ENABLED === "false") return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return; // never overlap with a slow previous run
    this.running = true;
    try {
      await this.failStaleJobs();
      for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
        const id = await this.claim();
        if (!id) break;
        await this.process(id);
      }
    } catch (err) {
      this.logger.error(`Import worker tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /* ───────────── claim / recover ───────────── */

  private async claim(): Promise<string | null> {
    const now = this.clock.now();
    const res = await this.dataSource.query(
      `UPDATE import_jobs SET status = 'running', started_at = $1, updated_at = $1, version = version + 1
        WHERE id = (SELECT id FROM import_jobs WHERE status = 'queued' ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id`,
      [now],
    );
    return firstRow<{ id: string }>(res)?.id ?? null;
  }

  private async failStaleJobs(): Promise<void> {
    const now = this.clock.now();
    const stale = JSON.stringify([{ row: 0, code: "WORKER_INTERRUPTED", message: "The import was interrupted (server restart); upload the file again" }]);
    const res = await this.dataSource.query(
      `UPDATE import_jobs SET status = 'failed', finished_at = $1, updated_at = $1, errors = $3::jsonb, error_count = error_count + 1, version = version + 1
        WHERE status = 'running' AND updated_at < $2 RETURNING id`,
      [now, new Date(now.getTime() - STALE_MS), stale],
    );
    for (const { id } of rowsOf<{ id: string }>(res)) {
      await this.files.delete(importFileKey(id)).catch(() => undefined);
      this.logger.warn(`Import job ${id} marked failed: worker interrupted`);
    }
  }

  /* ───────────── one job ───────────── */

  private async process(id: string): Promise<void> {
    const job = await this.repo.findOne({ where: { id } });
    if (!job || job.status !== "running") return;
    const key = importFileKey(id);
    const state: JobState = { totalRows: 0, processedRows: 0, created: 0, updated: 0, skipped: 0, errorCount: 0, errors: [] };

    await this.audit.record({ action: "import:start", entityType: "ImportJob", entityId: id, diff: { type: job.type, dryRun: job.dryRun, createdBy: job.createdBy ?? null } }).catch(() => undefined);
    try {
      const buffer = await this.files.read(key);
      if (!buffer) return await this.fail(job, state, "FILE_MISSING", "The uploaded CSV is no longer available; upload it again");

      const importer: Importer = job.type === "products" ? this.products : this.customers;
      let parsed: ReturnType<typeof readCsv>;
      try {
        parsed = readCsv(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
        const missing = importer.requiredColumns.filter((c) => !parsed.headers.includes(c));
        if (missing.length > 0) throw new CsvFormatError(`Missing required column(s): ${missing.join(", ")}`);
      } catch (err) {
        const message = err instanceof CsvFormatError ? err.message : "The file is not valid UTF-8 CSV text";
        return await this.fail(job, state, "CSV_INVALID", message);
      }

      const plan = importer.plan(parsed.rows);
      state.totalRows = parsed.rows.length;
      state.processedRows = plan.rejectedRows;
      this.addErrors(state, plan.errors);
      state.errorCount = plan.errors.length;
      if (!(await this.saveProgress(id, state))) return; // cancelled

      for (const batch of this.chunk(plan.units)) {
        if (await this.isCancelled(id)) return;
        const outcome = await this.runBatch(job, importer, batch);
        state.processedRows += outcome.processedRows;
        state.created += outcome.created;
        state.updated += outcome.updated;
        state.skipped += outcome.skipped;
        state.errorCount += outcome.errorCount;
        this.addErrors(state, outcome.errors);
        if (!(await this.saveProgress(id, state))) return; // cancelled while the batch ran
      }

      const finished = await this.dataSource.query(
        `UPDATE import_jobs SET status = 'done', processed_rows = total_rows, finished_at = $2, updated_at = $2, version = version + 1
          WHERE id = $1 AND status = 'running' RETURNING id`,
        [id, this.clock.now()],
      );
      if (firstRow(finished)) {
        await this.audit
          .record({
            action: "import:finish",
            entityType: "ImportJob",
            entityId: id,
            diff: { type: job.type, dryRun: job.dryRun, createdBy: job.createdBy ?? null, status: "done", totalRows: state.totalRows, created: state.created, updated: state.updated, skipped: state.skipped, errors: state.errorCount },
          })
          .catch(() => undefined);
      }
    } catch (err) {
      this.logger.error(`Import job ${id} crashed: ${err instanceof Error ? err.message : String(err)}`);
      await this.fail(job, state, "INTERNAL_ERROR", "Unexpected error while processing the import; rows saved so far are kept").catch(() => undefined);
    } finally {
      await this.files.delete(key).catch(() => undefined); // the CSV holds personal data: never keep it after the job ends
    }
  }

  private async runBatch(job: ImportJob, importer: Importer, batch: ImportUnit[]): Promise<BatchOutcome> {
    const ctx = { now: this.clock.now() };
    try {
      return await this.tx.run(async (manager) => {
        const outcome = await importer.processBatch(manager, batch, ctx);
        if (job.dryRun) throw new DryRunRollback(outcome); // validate everything, persist nothing
        return outcome;
      });
    } catch (err) {
      if (err instanceof DryRunRollback) return err.outcome;
      throw err;
    }
  }

  /** Groups units into batches of at least 50 rows (a product's rows are never split). */
  private chunk(units: ImportUnit[]): ImportUnit[][] {
    const batches: ImportUnit[][] = [];
    let current: ImportUnit[] = [];
    let rows = 0;
    for (const unit of units) {
      current.push(unit);
      rows += unit.rows.length;
      if (rows >= BATCH_SIZE) {
        batches.push(current);
        current = [];
        rows = 0;
      }
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  private addErrors(state: JobState, errors: ImportRowError[]): void {
    for (const e of errors) if (state.errors.length < MAX_STORED_ERRORS) state.errors.push(e);
  }

  /** False when the job is no longer `running` (cancelled): the caller stops. */
  private async saveProgress(id: string, s: JobState): Promise<boolean> {
    const res = await this.dataSource.query(
      `UPDATE import_jobs SET total_rows = $2, processed_rows = $3, created_count = $4, updated_count = $5, skipped_count = $6,
              error_count = $7, errors = $8::jsonb, updated_at = $9, version = version + 1
        WHERE id = $1 AND status = 'running' RETURNING id`,
      [id, s.totalRows, s.processedRows, s.created, s.updated, s.skipped, s.errorCount, JSON.stringify(s.errors), this.clock.now()],
    );
    return firstRow(res) !== undefined;
  }

  private async isCancelled(id: string): Promise<boolean> {
    const rows = await this.dataSource.query("SELECT status FROM import_jobs WHERE id = $1", [id]);
    return firstRow<{ status: string }>(rows)?.status !== "running";
  }

  private async fail(job: ImportJob, state: JobState, code: string, message: string): Promise<void> {
    const errors = state.errors.slice(0, MAX_STORED_ERRORS - 1);
    errors.push({ row: 0, code, message });
    const res = await this.dataSource.query(
      `UPDATE import_jobs SET status = 'failed', total_rows = $2, processed_rows = $3, created_count = $4, updated_count = $5, skipped_count = $6,
              error_count = $7, errors = $8::jsonb, finished_at = $9, updated_at = $9, version = version + 1
        WHERE id = $1 AND status = 'running' RETURNING id`,
      [job.id, state.totalRows, state.processedRows, state.created, state.updated, state.skipped, state.errorCount + 1, JSON.stringify(errors), this.clock.now()],
    );
    if (firstRow(res)) {
      await this.audit
        .record({ action: "import:finish", entityType: "ImportJob", entityId: job.id, diff: { type: job.type, dryRun: job.dryRun, status: "failed", code, processed: state.processedRows } })
        .catch(() => undefined);
    }
  }
}
