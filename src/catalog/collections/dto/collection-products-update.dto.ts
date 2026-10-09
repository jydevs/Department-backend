import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const collectionProductsUpdateSchema = z.object({
  products: z.array(
    z.object({
      productId: z.string().uuid(),
    })
  ).min(0).max(1000),
});

export type CollectionProductsUpdateInput = z.infer<typeof collectionProductsUpdateSchema>;
export class UpdateCollectionProductsDto extends createZodDto(collectionProductsUpdateSchema) {}
