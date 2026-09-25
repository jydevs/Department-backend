import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const updateTaxSchema = z.strictObject({
  pricesIncludeTax: z.boolean(),
  ratePercent: z
    .number()
    .min(0)
    .max(100)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most 2 decimals"),
  label: z.string().trim().min(1).max(40).refine((s) => !/\p{Cc}/u.test(s), "Invalid characters"),
});
export type UpdateTaxInput = z.infer<typeof updateTaxSchema>;
export class UpdateTaxDto extends createZodDto(updateTaxSchema) {}

export interface TaxSettingsDto {
  pricesIncludeTax: boolean;
  ratePercent: number;
  label: string;
  updatedAt: Date | null;
}
