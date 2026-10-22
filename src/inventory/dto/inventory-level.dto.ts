import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const inventoryLevelResponseSchema = z.object({
  id: z.string().uuid(),
  variantId: z.string().uuid(),
  variantTitle: z.string(),
  variantSku: z.string().nullable(),
  productId: z.string().uuid().nullable(),
  productTitle: z.string().nullable(),
  productHandle: z.string().nullable(),
  locationId: z.string().uuid(),
  locationName: z.string(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  lowStock: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type InventoryLevelResponseDto = z.infer<typeof inventoryLevelResponseSchema>;
export class InventoryLevelDto extends createZodDto(inventoryLevelResponseSchema) {}

const inventoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(255).optional(),
  locationId: z.string().uuid().optional(),
  /** Only when `lowStock=true`: rows with available <= lowStockThreshold (default 5). */
  lowStock: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  lowStockThreshold: z.coerce.number().int().min(0).max(1_000_000).default(5),
});

export type InventoryQueryParams = z.infer<typeof inventoryQuerySchema>;
export class InventoryQueryDto extends createZodDto(inventoryQuerySchema) {}

const MAX_QTY = 1_000_000;

const adjustInventorySchema = z.object({
  variantId: z.string().uuid(),
  locationId: z.string().uuid(),
  delta: z.number().int().min(-MAX_QTY).max(MAX_QTY).refine((n) => n !== 0, "delta must not be 0").optional(),
  setTo: z.number().int().min(0).max(MAX_QTY).optional(),
  reason: z.enum(["received", "correction", "sold", "returned", "damaged", "restock", "other"]),
  note: z.string().max(1000).optional(),
}).refine((v) => (v.delta === undefined) !== (v.setTo === undefined), {
  message: "Provide exactly one of delta or setTo",
  path: ["delta"],
});

export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;
export class AdjustInventoryDto extends createZodDto(adjustInventorySchema) {}

const inventoryAdjustmentResponseSchema = z.object({
  id: z.string().uuid(),
  variantId: z.string().uuid(),
  variantTitle: z.string().nullable(),
  productId: z.string().uuid().nullable(),
  productTitle: z.string().nullable(),
  productHandle: z.string().nullable(),
  locationId: z.string().uuid(),
  delta: z.number().int(),
  reason: z.string(),
  note: z.string().nullable(),
  actorId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
});

export type InventoryAdjustmentResponseDto = z.infer<typeof inventoryAdjustmentResponseSchema>;
export class InventoryAdjustmentDto extends createZodDto(inventoryAdjustmentResponseSchema) {}

export const adjustmentCursorSchema = z.object({
  c: z.string().datetime(),
  id: z.string().uuid(),
});

const adjustmentQuerySchema = z.object({
  limit: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(100).default(24)),
  cursor: z.string().max(512).optional(),
  variantId: z.string().uuid().optional(),
});

export type AdjustmentQueryParams = z.infer<typeof adjustmentQuerySchema>;
export type AdjustmentCursorPayload = z.infer<typeof adjustmentCursorSchema>;
export class AdjustmentQueryDto extends createZodDto(adjustmentQuerySchema) {}
