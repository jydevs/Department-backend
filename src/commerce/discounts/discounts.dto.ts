import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { dateInput } from "../../common/zod/date-input";

const MAX_MONEY = 10_000_000_000;
const noControl = (s: string) => !/\p{Cc}/u.test(s);

export const discountCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/);
const title = z.string().trim().min(2).max(120).refine(noControl, "Invalid characters");
const type = z.enum(["percent", "fixed", "free_shipping"]);

const createDiscountSchema = z
  .strictObject({
    code: discountCodeSchema,
    title,
    type,
    value: z.number().int().min(0).max(MAX_MONEY).default(0),
    minSubtotal: z.number().int().min(0).max(MAX_MONEY).nullable().default(null),
    startsAt: dateInput.optional(),
    endsAt: dateInput.nullable().default(null),
    usageLimit: z.number().int().min(1).max(10_000_000).nullable().default(null),
    oncePerEmail: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.type === "percent" && (v.value < 1 || v.value > 100)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Percent value must be between 1 and 100" });
    }
    if (v.type === "fixed" && v.value < 1) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Fixed value must be at least 1" });
    }
    if (v.type === "free_shipping" && v.value !== 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "free_shipping discounts have no value" });
    }
    if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt must be after startsAt" });
    }
  });
export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;
export class CreateDiscountDto extends createZodDto(createDiscountSchema) {}

/** The code and the type are immutable (redemptions reference them); cross-field rules are re-checked in the service. */
const updateDiscountSchema = z
  .strictObject({
    title,
    value: z.number().int().min(0).max(MAX_MONEY),
    minSubtotal: z.number().int().min(0).max(MAX_MONEY).nullable(),
    startsAt: dateInput,
    endsAt: dateInput.nullable(),
    usageLimit: z.number().int().min(1).max(10_000_000).nullable(),
    oncePerEmail: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;
export class UpdateDiscountDto extends createZodDto(updateDiscountSchema) {}

const listDiscountsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(60).optional(),
  isActive: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
export type ListDiscountsQuery = z.infer<typeof listDiscountsQuerySchema>;
export class ListDiscountsQueryDto extends createZodDto(listDiscountsQuerySchema) {}

export interface DiscountDto {
  id: string;
  code: string;
  title: string;
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  minSubtotal: number | null;
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  oncePerEmail: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscountRedemptionDto {
  id: string;
  orderId: string;
  orderNumber: number | null;
  email: string;
  amount: number;
  createdAt: Date;
}
