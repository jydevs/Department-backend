import { z } from "zod";

// Smart collection rule DSL: { match: "all"|"any", conditions: [...] }
// Each condition: { field, op, value } where field/op are whitelisted and validated per field.

const conditionFieldSchema = z.enum(["tag", "vendor", "type", "price"]);
const conditionOperatorSchema = z.enum(["eq", "neq", "gt", "lt", "contains"]);

const collectionConditionSchema = z
  .object({
    field: conditionFieldSchema,
    op: conditionOperatorSchema,
    value: z.union([z.string(), z.number()]),
  })
  .superRefine((cond, ctx) => {
    if (cond.field === "price") {
      if (!["eq", "neq", "gt", "lt"].includes(cond.op)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["op"], message: "price supports eq, neq, gt, lt" });
      }
      const amount = typeof cond.value === "number" ? cond.value : cond.value.trim() === "" ? NaN : Number(cond.value);
      if (!Number.isSafeInteger(amount) || amount < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "price must be a non-negative integer" });
      }
      return;
    }
    if (!["eq", "neq", "contains"].includes(cond.op)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["op"], message: `${cond.field} supports eq, neq, contains` });
    }
    if (typeof cond.value !== "string" || cond.value.trim() === "" || cond.value.length > 255) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "value must be a non-empty string (max 255)" });
    }
  });

export const collectionRulesSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(collectionConditionSchema).min(1).max(20),
});

export type CollectionRules = z.infer<typeof collectionRulesSchema>;
export type CollectionCondition = z.infer<typeof collectionConditionSchema>;
export type ConditionField = z.infer<typeof conditionFieldSchema>;
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;
