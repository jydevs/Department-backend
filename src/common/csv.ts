/**
 * CSV cell safe for spreadsheets: neutralises formula injection (leading = + - @ TAB CR get a `'` prefix),
 * duplicates double quotes and ALWAYS wraps the value in double quotes (RFC 4180).
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
