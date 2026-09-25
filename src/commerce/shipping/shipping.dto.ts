import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const MAX_MONEY = 10_000_000_000;
const noControl = (s: string) => !/\p{Cc}/u.test(s);

const zoneName = z.string().trim().min(2).max(120).refine(noControl, "Invalid characters");
const department = z.string().trim().min(1).max(60).refine(noControl, "Invalid characters");
const departments = z
  .array(department)
  .min(1)
  .max(40)
  .refine((v) => new Set(v.map((d) => d.toLowerCase())).size === v.length, "Duplicate departments")
  .refine((v) => !v.includes("*") || v.length === 1, "\"*\" (whole country) cannot be combined with other departments");

const createZoneSchema = z.strictObject({
  name: zoneName,
  departments,
  isActive: z.boolean().default(true),
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export class CreateZoneDto extends createZodDto(createZoneSchema) {}

const updateZoneSchema = z
  .strictObject({ name: zoneName, departments, isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;
export class UpdateZoneDto extends createZodDto(updateZoneSchema) {}

const rateFields = {
  name: z.string().trim().min(1).max(120).refine(noControl, "Invalid characters"),
  price: z.number().int().min(0).max(MAX_MONEY),
  freeOverSubtotal: z.number().int().min(0).max(MAX_MONEY).nullable(),
  minDays: z.number().int().min(0).max(365).nullable(),
  maxDays: z.number().int().min(0).max(365).nullable(),
  isActive: z.boolean(),
  position: z.number().int().min(0).max(1000),
};
const daysOrdered = (v: { minDays?: number | null; maxDays?: number | null }) =>
  v.minDays == null || v.maxDays == null || v.minDays <= v.maxDays;

const createRateSchema = z
  .strictObject({
    zoneId: z.uuid(),
    name: rateFields.name,
    price: rateFields.price,
    freeOverSubtotal: rateFields.freeOverSubtotal.default(null),
    minDays: rateFields.minDays.default(null),
    maxDays: rateFields.maxDays.default(null),
    isActive: rateFields.isActive.default(true),
    position: rateFields.position.default(0),
  })
  .refine(daysOrdered, "minDays cannot exceed maxDays");
export type CreateRateInput = z.infer<typeof createRateSchema>;
export class CreateRateDto extends createZodDto(createRateSchema) {}

const updateRateSchema = z
  .strictObject({
    name: rateFields.name,
    price: rateFields.price,
    freeOverSubtotal: rateFields.freeOverSubtotal,
    minDays: rateFields.minDays,
    maxDays: rateFields.maxDays,
    isActive: rateFields.isActive,
    position: rateFields.position,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")
  .refine(daysOrdered, "minDays cannot exceed maxDays");
export type UpdateRateInput = z.infer<typeof updateRateSchema>;
export class UpdateRateDto extends createZodDto(updateRateSchema) {}

const listRatesQuerySchema = z.object({ zoneId: z.uuid().optional() });
export class ListRatesQueryDto extends createZodDto(listRatesQuerySchema) {}

const storefrontRatesQuerySchema = z.object({
  department: z.string().trim().min(1).max(60),
  cartId: z.uuid(),
});
export class StorefrontRatesQueryDto extends createZodDto(storefrontRatesQuerySchema) {}

export interface ShippingRateDto {
  id: string;
  zoneId: string;
  name: string;
  price: number;
  freeOverSubtotal: number | null;
  minDays: number | null;
  maxDays: number | null;
  isActive: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShippingZoneDto {
  id: string;
  name: string;
  departments: string[];
  isActive: boolean;
  rates: ShippingRateDto[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StorefrontShippingRateDto {
  id: string;
  name: string;
  /** Price to charge for this cart (0 when free by threshold or by a free_shipping discount). */
  price: number;
  basePrice: number;
  isFree: boolean;
  minDays: number | null;
  maxDays: number | null;
}
