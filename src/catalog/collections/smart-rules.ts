import { SqlParams } from "../../common/sql/sql-params";
import { escapeLike } from "../../common/sql/escape-like";
import { CollectionRules } from "./dto";

/**
 * Translate smart-collection rules into ONE parenthesised SQL condition over the `products p` alias.
 * Fields/operators come from a fixed whitelist (validated by Zod) and every value is bound as a parameter.
 * Returns "FALSE" when no rule can be translated so an unresolvable collection never matches everything.
 */
export function buildSmartRulesCondition(rules: CollectionRules, params: SqlParams): string {
  const clauses: string[] = [];

  for (const cond of rules.conditions) {
    const clause = buildClause(cond.field, cond.op, cond.value, params);
    if (clause) clauses.push(clause);
  }

  if (clauses.length === 0) return "FALSE";
  return `(${clauses.join(rules.match === "all" ? " AND " : " OR ")})`;
}

function buildClause(field: string, op: string, value: string | number, params: SqlParams): string | null {
  if (field === "tag") {
    if (op === "eq") return `(p.tags @> ARRAY[${params.push(String(value))}]::text[])`;
    if (op === "neq") return `(NOT (p.tags @> ARRAY[${params.push(String(value))}]::text[]))`;
    if (op === "contains") {
      const ph = params.push(`%${escapeLike(String(value))}%`);
      return `EXISTS (SELECT 1 FROM unnest(p.tags) AS t(tag) WHERE t.tag ILIKE ${ph})`;
    }
    return null;
  }

  if (field === "vendor" || field === "type") {
    const column = field === "vendor" ? "p.vendor" : "p.product_type";
    if (op === "eq") return `(${column} = ${params.push(String(value))}::text)`;
    if (op === "neq") return `(${column} IS DISTINCT FROM ${params.push(String(value))}::text)`;
    if (op === "contains") return `(${column} ILIKE ${params.push(`%${escapeLike(String(value))}%`)})`;
    return null;
  }

  if (field === "price") {
    const sqlOp = op === "eq" ? "=" : op === "neq" ? "<>" : op === "gt" ? ">" : op === "lt" ? "<" : null;
    const amount = Number(value);
    if (!sqlOp || !Number.isSafeInteger(amount)) return null;
    return `EXISTS (SELECT 1 FROM variants rv WHERE rv.product_id = p.id AND rv.is_active = true AND rv.price ${sqlOp} ${params.push(amount)}::bigint)`;
  }

  return null;
}
