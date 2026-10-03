import { z } from "zod";
import { sectionEnvelopeSchema, validateSection } from "../sections/registry";

export const MAX_SECTIONS = 40;
export const TEMPLATE_KEYS = ["home", "collection", "product", "cart", "search", "404", "page", "layout"] as const;

/** Adds per-section registry validation and unique section ids. */
export function refineSections(sections: { id: string }[], ctx: z.RefinementCtx, basePath: (string | number)[]): void {
  const ids = new Set<string>();
  sections.forEach((section, i) => {
    if (ids.has(section.id)) ctx.addIssue({ code: "custom", path: [...basePath, i, "id"], message: "Id de sección duplicado" });
    ids.add(section.id);
    for (const issue of validateSection(section)) {
      ctx.addIssue({
        code: "custom",
        path: [...basePath, i, ...issue.path.split(".").filter((p) => p.length > 0)],
        message: issue.message,
      });
    }
  });
}

export const templateSchema = z
  .object({ sections: z.array(sectionEnvelopeSchema).max(MAX_SECTIONS) })
  .strict()
  .superRefine((doc, ctx) => refineSections(doc.sections, ctx, ["sections"]));

export type TemplateDocument = z.infer<typeof templateSchema>;
