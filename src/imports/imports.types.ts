import type { EntityManager } from "typeorm";
import type { ImportRowError } from "./entities/import-job.entity";

/** One CSV data row: `line` is the 1-based file line (header = 1), `cells` keys are normalised headers. */
export interface ImportRow {
  line: number;
  cells: Readonly<Record<string, string>>;
}

/** Smallest thing processed atomically: one customer row, or all rows of one product handle. */
export interface ImportUnit {
  line: number;
  rows: ImportRow[];
}

export type UnitOutcome = "created" | "updated" | "skipped";

export interface BatchOutcome {
  processedRows: number;
  created: number;
  updated: number;
  skipped: number;
  errorCount: number;
  errors: ImportRowError[];
}

export interface PlanResult {
  units: ImportUnit[];
  errors: ImportRowError[];
  /** Rows dropped while planning (already reported in `errors`). */
  rejectedRows: number;
}

export interface BatchContext {
  now: Date;
}

export interface Importer {
  /** Normalised header names that must exist in the file. */
  readonly requiredColumns: readonly string[];
  plan(rows: ImportRow[]): PlanResult;
  processBatch(manager: EntityManager, units: ImportUnit[], ctx: BatchContext): Promise<BatchOutcome>;
}

/** Expected, per-row failure: reported in `errors`, never aborts the job. */
export class ImportRowException extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const BATCH_SIZE = 50;
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 64;
export const MAX_CELL_CHARS = 100_000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function emptyOutcome(): BatchOutcome {
  return { processedRows: 0, created: 0, updated: 0, skipped: 0, errorCount: 0, errors: [] };
}
