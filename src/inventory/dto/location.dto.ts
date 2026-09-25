import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const locationResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type LocationResponseDto = z.infer<typeof locationResponseSchema>;
export class LocationDto extends createZodDto(locationResponseSchema) {}

const createLocationSchema = z.object({
  name: z.string().min(1).max(255),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export class CreateLocationDto extends createZodDto(createLocationSchema) {}

const updateLocationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  /** Required to deactivate or unset the current default: the location that becomes default in the same transaction. */
  replacementDefaultId: z.string().uuid().optional(),
});

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export class UpdateLocationDto extends createZodDto(updateLocationSchema) {}
