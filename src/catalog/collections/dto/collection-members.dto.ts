import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** `/admin/collections/:id/products/:productId` */
const collectionMemberParamSchema = z.object({ id: z.uuid(), productId: z.uuid() });
export class CollectionMemberParamDto extends createZodDto(collectionMemberParamSchema) {}

const collectionMembersAddSchema = z.object({
  productIds: z.array(z.uuid()).min(1).max(100),
  /** 0-based index where the new members are inserted (in the given order); omitted = at the end. */
  position: z.number().int().min(0).max(100000).optional(),
});
export type CollectionMembersAddInput = z.infer<typeof collectionMembersAddSchema>;
export class AddCollectionMembersDto extends createZodDto(collectionMembersAddSchema) {}

const collectionMemberReorderSchema = z.object({
  productId: z.uuid(),
  /** New 0-based index of the product among the members (clamped to the last position). */
  position: z.number().int().min(0).max(100000),
});
export type CollectionMemberReorderInput = z.infer<typeof collectionMemberReorderSchema>;
export class ReorderCollectionMemberDto extends createZodDto(collectionMemberReorderSchema) {}

const collectionMemberSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  title: z.string(),
  status: z.string(),
  image: z.object({ url: z.string(), alt: z.string().nullable(), width: z.number().nullable(), height: z.number().nullable() }).nullable(),
  position: z.number().int(),
});
export type CollectionMember = z.infer<typeof collectionMemberSchema>;
export class CollectionMemberDto extends createZodDto(collectionMemberSchema) {}

const collectionMembersAddResultSchema = z.object({
  added: z.array(z.string().uuid()),
  alreadyMembers: z.array(z.string().uuid()),
  total: z.number().int(),
});
export type CollectionMembersAddResult = z.infer<typeof collectionMembersAddResultSchema>;
export class CollectionMembersAddResultDto extends createZodDto(collectionMembersAddResultSchema) {}
