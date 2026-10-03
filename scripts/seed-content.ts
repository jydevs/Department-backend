import "reflect-metadata";
import { DataSource } from "typeorm";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { buildDbOptions } from "../src/database/db-options";
import { seedDefaultContent } from "../src/cms/seed/default-content";

/** `yarn content:seed` — creates the default CMS documents that do not exist yet (never overwrites edits). */
async function main() {
  loadDotEnv();
  const env = loadEnv();
  const dataSource = new DataSource(buildDbOptions(env));
  try {
    await dataSource.initialize();
    const { created, skipped, failed } = await seedDefaultContent(dataSource, { logger: { log: console.log, warn: console.warn } });
    if (created.length > 0) console.log(`Created: ${created.join(", ")}`);
    if (failed.length > 0) process.exitCode = 1;
    if (skipped.length > 0) console.log(`Already present (untouched): ${skipped.join(", ")}`);
  } catch (error) {
    console.error("Error seeding default content:", error);
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

void main();
