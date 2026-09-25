import { DataSource } from "typeorm";
import { DEFAULT_TEMPLATES } from "./default-templates";
import { EmailTemplate } from "./entities";

/**
 * Idempotent: inserts only the templates that are missing (ON CONFLICT (key) DO NOTHING),
 * so edits made by an admin are never overwritten. Returns how many rows were inserted.
 */
export async function seedEmailTemplates(dataSource: DataSource): Promise<number> {
  let inserted = 0;
  for (const tpl of DEFAULT_TEMPLATES) {
    const result = await dataSource
      .createQueryBuilder()
      .insert()
      .into(EmailTemplate)
      .values({ key: tpl.key, subject: tpl.subject, bodyHtml: tpl.bodyHtml, bodyText: tpl.bodyText, isActive: true })
      .orIgnore()
      .execute();
    inserted += result.raw.length > 0 ? 1 : 0;
  }
  return inserted;
}
