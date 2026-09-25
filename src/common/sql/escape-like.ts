/** Escape `%`, `_` and the backslash so user input matches literally inside LIKE / ILIKE (use with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}
