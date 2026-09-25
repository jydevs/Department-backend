/** CSV cell safe for spreadsheets: neutralises formula injection (= + - @ tab CR) and always quotes. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
