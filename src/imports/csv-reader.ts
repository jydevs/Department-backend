import { parse } from "csv-parse/sync";
import { MAX_CELL_CHARS, MAX_COLUMNS, MAX_ROWS, type ImportRow } from "./imports.types";

/** Fatal, file-level problem (malformed CSV, limits): the job ends `failed` with this message. */
export class CsvFormatError extends Error {}

interface ParsedRecord {
  record: Record<string, string>;
  info: { lines: number };
}

/** "Variant Price" -> "variantprice", "Body (HTML)" -> "bodyhtml": lowercase, only letters and digits. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Strict RFC 4180 parse: BOM stripped, quotes must be balanced, every row has the header's column count,
 * at most 5000 data rows / 64 columns / 100 000 characters per cell. Nothing is ever evaluated.
 */
export function readCsv(text: string): { headers: string[]; rows: ImportRow[] } {
  let headers: string[] = [];
  let parsed: ParsedRecord[];
  try {
    parsed = parse(text, {
      bom: true,
      columns: (raw: string[]): string[] => {
        if (raw.length > MAX_COLUMNS) throw new CsvFormatError(`The file has more than ${MAX_COLUMNS} columns`);
        headers = raw.map(normalizeHeader);
        if (headers.some((h) => h === "")) throw new CsvFormatError("The header row contains an empty column name");
        if (new Set(headers).size !== headers.length) throw new CsvFormatError("The header row contains duplicated column names");
        return headers;
      },
      relax_column_count: false,
      relax_quotes: false,
      skip_empty_lines: true,
      trim: false,
      info: true,
      max_record_size: MAX_COLUMNS * MAX_CELL_CHARS * 4,
      to: MAX_ROWS + 1, // one more than allowed, only to detect the excess
    }) as ParsedRecord[];
  } catch (err) {
    if (err instanceof CsvFormatError) throw err;
    throw new CsvFormatError(`Malformed CSV: ${describeParseError(err)}`);
  }

  if (parsed.length === 0) throw new CsvFormatError("The file has no data rows");
  if (parsed.length > MAX_ROWS) throw new CsvFormatError(`The file has more than ${MAX_ROWS} data rows`);

  const rows: ImportRow[] = [];
  for (const { record, info } of parsed) {
    for (const value of Object.values(record)) {
      if (value.length > MAX_CELL_CHARS) throw new CsvFormatError(`A cell on line ${info.lines} exceeds ${MAX_CELL_CHARS} characters`);
    }
    rows.push({ line: info.lines, cells: record });
  }
  return { headers, rows };
}

/** csv-parse error messages can quote the offending record: keep only the code and the line number. */
function describeParseError(err: unknown): string {
  const e = err as { code?: string; lines?: number; message?: string };
  const code = typeof e.code === "string" ? e.code : "PARSE_ERROR";
  const line = typeof e.lines === "number" ? ` near line ${e.lines}` : "";
  const hint =
    code === "CSV_QUOTE_NOT_CLOSED"
      ? "a quoted value is never closed"
      : code === "CSV_RECORD_INCONSISTENT_COLUMNS" || code === "CSV_RECORD_INCONSISTENT_FIELDS_LENGTH"
        ? "a row has a different number of columns than the header"
        : code === "INVALID_OPENING_QUOTE" || code === "CSV_INVALID_CLOSING_QUOTE"
          ? "quotes are misplaced"
          : "the file is not valid CSV";
  return `${hint} (${code}${line})`;
}
