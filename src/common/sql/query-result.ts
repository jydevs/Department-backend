/**
 * `manager.query()` on the pg driver resolves to the rows for SELECT/INSERT but to `[rows, affectedCount]`
 * for UPDATE/DELETE (even with RETURNING). These helpers normalise both shapes.
 */
function isUpdateShape(res: unknown): res is [unknown[], number] {
  return Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === "number";
}

export function rowsOf<T = Record<string, unknown>>(res: unknown): T[] {
  if (isUpdateShape(res)) return res[0] as T[];
  return Array.isArray(res) ? (res as T[]) : [];
}

export function firstRow<T = Record<string, unknown>>(res: unknown): T | undefined {
  return rowsOf<T>(res)[0];
}

export function affectedCount(res: unknown): number {
  if (isUpdateShape(res)) return res[1];
  return rowsOf(res).length;
}
