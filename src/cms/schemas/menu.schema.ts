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
