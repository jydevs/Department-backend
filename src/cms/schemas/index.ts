import type { z } from "zod";
import type { ContentKind } from "../entities/content-document.entity";
import { pageSchema } from "./page.schema";
import { menuRawDepthIssue, menuSchema } from "./menu.schema";
import { settingsSchema } from "./settings.schema";
import { TEMPLATE_KEYS, templateSchema } from "./template.schema";

export * from "./common";
export * from "./menu.schema";
export * from "./page.schema";
export * from "./settings.schema";
export * from "./template.schema";

export interface DocumentIssue {
  path: string;
  message: string;
}

export type ParseDocumentResult = { ok: true; data: Record<string, unknown> } | { ok: false; issues: DocumentIssue[] };

const KIND_SCHEMAS: Record<ContentKind, z.ZodType> = {
  settings: settingsSchema,
  menu: menuSchema,
  template: templateSchema,
  page: pageSchema,
};

/** Validates `data` for a document kind. For pages, `handle` must equal `key`. */
export function parseDocument(kind: ContentKind, key: string, data: unknown): ParseDocumentResult {
  const schema = KIND_SCHEMAS[kind] as z.ZodType | undefined;
  if (!schema) return { ok: false, issues: [{ path: "kind", message: `Tipo de documento desconocido: ${kind}` }] };
  if (kind === "menu") {
    const deep = menuRawDepthIssue(data);
    if (deep) return { ok: false, issues: [deep] };
  }
  if (kind === "template" && !(TEMPLATE_KEYS as readonly string[]).includes(key)) {
    return { ok: false, issues: [{ path: "key", message: `La clave de template debe ser una de: ${TEMPLATE_KEYS.join(", ")}` }] };
  }
  if (kind === "settings" && key !== "site") {
    return { ok: false, issues: [{ path: "key", message: 'La clave de settings debe ser "site"' }] };
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) };
  }
  const out = parsed.data as Record<string, unknown>;
  if (kind === "page" && out.handle !== key) {
    return { ok: false, issues: [{ path: "handle", message: "El handle debe coincidir con la clave del documento" }] };
  }
  return { ok: true, data: out };
}
