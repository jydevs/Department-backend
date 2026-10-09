import { z } from "zod";
import { handleSlug, nodeId, safeLinkUrl } from "./common";

export type MenuLink = { type: "collection" | "product" | "page"; handle: string } | { type: "url"; url: string };

export interface MenuItem {
  id: string;
  label: string;
  link: MenuLink;
  children?: MenuItem[];
}

const menuLinkSchema: z.ZodType<MenuLink> = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["collection", "product", "page"]), handle: handleSlug }).strict(),
  z.object({ type: z.literal("url"), url: safeLinkUrl }).strict(),
]);

export const menuItemSchema: z.ZodType<MenuItem> = z.lazy(() =>
  z
    .object({
      id: nodeId,
      label: z.string().min(1).max(60),
      link: menuLinkSchema,
      children: z.array(menuItemSchema).max(50).optional(),
    })
    .strict(),
);

export const MENU_MAX_DEPTH = 3;
export const MENU_MAX_ITEMS = 50;
/** Hard guard applied to the RAW json before recursive zod parsing (the schema itself enforces MENU_MAX_DEPTH). */
const MENU_RAW_MAX_LEVELS = 4;

/** Iterative scan of untrusted menu JSON: returns an issue if nesting exceeds the guard, so the recursive parser never sees it. */
export function menuRawDepthIssue(raw: unknown): { path: string; message: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const root = (raw as { items?: unknown }).items;
  if (!Array.isArray(root)) return null;
  const stack: { items: unknown[]; level: number; path: string }[] = [{ items: root, level: 1, path: "items" }];
  let visited = 0;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (let i = 0; i < cur.items.length; i++) {
      const item = cur.items[i];
      if (typeof item !== "object" || item === null) continue;
      if (++visited > 10_000) return { path: "items", message: "Menú demasiado grande" };
      const children = (item as { children?: unknown }).children;
      if (!Array.isArray(children) || children.length === 0) continue;
      if (cur.level + 1 > MENU_RAW_MAX_LEVELS) return { path: `${cur.path}.${i}.children`, message: `Profundidad máxima ${MENU_RAW_MAX_LEVELS} niveles` };
      stack.push({ items: children, level: cur.level + 1, path: `${cur.path}.${i}.children` });
    }
  }
  return null;
}

export const menuSchema = z
  .object({ items: z.array(menuItemSchema).max(MENU_MAX_ITEMS) })
  .strict()
  .superRefine((menu, ctx) => {
    let total = 0;
    const ids = new Set<string>();
    const walk = (items: MenuItem[], depth: number, path: (string | number)[]): void => {
      items.forEach((item, i) => {
        const p = [...path, i];
        total += 1;
        if (depth > MENU_MAX_DEPTH) {
          ctx.addIssue({ code: "custom", path: p, message: `Profundidad máxima ${MENU_MAX_DEPTH}` });
          return;
        }
        if (ids.has(item.id)) ctx.addIssue({ code: "custom", path: [...p, "id"], message: "Id duplicado" });
        ids.add(item.id);
        if (item.children) walk(item.children, depth + 1, [...p, "children"]);
      });
    };
    walk(menu.items, 1, ["items"]);
    if (total > MENU_MAX_ITEMS) {
      ctx.addIssue({ code: "custom", path: ["items"], message: `Máximo ${MENU_MAX_ITEMS} ítems en total` });
    }
  });

export type MenuDocument = z.infer<typeof menuSchema>;
