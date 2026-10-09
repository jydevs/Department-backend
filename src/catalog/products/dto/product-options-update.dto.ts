import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { productOptionInputSchema } from "./product-option.dto";

const optionsUpdateSchema = z.object({
  options: z.array(productOptionInputSchema).max(3),
  force: z.boolean().default(false),
});

export type OptionsUpdateInput = z.infer<typeof optionsUpdateSchema>;
export class UpdateOptionsDto extends createZodDto(optionsUpdateSchema) {}
