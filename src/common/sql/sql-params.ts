/** Positional parameter collector for raw SQL: `push(value)` returns the `$n` placeholder to embed. */
export class SqlParams {
  readonly values: unknown[] = [];

  push(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}
