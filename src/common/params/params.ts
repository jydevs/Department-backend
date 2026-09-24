import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** `/things/:id` — a malformed uuid is a 400, never a Postgres 500. */
export const idParamSchema = z.object({ id: z.uuid() });
export class IdParamDto extends createZodDto(idParamSchema) {}

/** `/products/:handle` — URL slug as used by Shopify-style handles. */
export const handleParamSchema = z.object({ handle: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120) });
export class HandleParamDto extends createZodDto(handleParamSchema) {}
