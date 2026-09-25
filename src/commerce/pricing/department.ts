/** Lowercase, accent-free, single-spaced: "Bogotá  D.C." and "bogota d.c." compare equal. */
export function normalizeDepartment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** A zone covers a department when it lists "*" or the normalized name/code. No department only matches "*". */
export function zoneCoversDepartment(zoneDepartments: readonly string[], department: string | null | undefined): boolean {
  if (zoneDepartments.includes("*")) return true;
  if (!department) return false;
  const wanted = normalizeDepartment(department);
  return zoneDepartments.some((d) => normalizeDepartment(d) === wanted);
}
