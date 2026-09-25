import { z } from "zod";
import { sectionEnvelopeSchema } from "../sections/registry";
import { handleSlug } from "./common";
import { MAX_SECTIONS, refineSections } from "./template.schema";

export const pageSchema = z
  .object({
    title: z.string().min(1).max(255),
    handle: handleSlug,
    template: z.literal("page"),
    seoTitle: z.string().max(255).optional(),
    seoDescription: z.string().max(320).optional(),
    sections: z.array(sectionEnvelopeSchema).max(MAX_SECTIONS),
  })
  .strict()
  .superRefine((doc, ctx) => refineSections(doc.sections, ctx, ["sections"]));

export type PageDocument = z.infer<typeof pageSchema>;
