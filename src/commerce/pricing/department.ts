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

/**
 * Which zones apply to a department: a zone that NAMES the department wins over the catch-all ("*") zone.
 * Without this, a "Resto del país" zone would also be offered to buyers in Bogotá next to the Bogotá rates.
 * `zones` are the departments lists of every active zone that has at least one active rate.
 */
export function applicableZoneDepartments(zones: readonly (readonly string[])[], department: string | null | undefined): (readonly string[])[] {
  const covering = zones.filter((z) => zoneCoversDepartment(z, department));
  const specific = covering.filter((z) => !z.includes("*"));
  return specific.length > 0 ? specific : covering;
}
