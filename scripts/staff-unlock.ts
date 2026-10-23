import "reflect-metadata";
import { DataSource } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { buildDbOptions } from "../src/database/db-options";

/**
 * Lifts every login lock of a staff member (per-IP pair locks and the global back-off):
 *   yarn staff:unlock <email>
 * Deletes the account's login_attempts rows and writes an audit row with actor `system`.
 * It only runs with database access (the operator), never through the API.
 */
async function main() {
  loadDotEnv();
  const env = loadEnv();
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: yarn staff:unlock <email>");
    process.exit(1);
  }

  const dataSource = new DataSource(buildDbOptions(env));
  try {
    await dataSource.initialize();
    const cleared = await dataSource.transaction(async (manager) => {
      const rows = (await manager.query("SELECT id FROM staff_users WHERE email = $1", [email])) as Array<{ id: string }>;
      const id = rows[0]?.id;
      if (!id) return null;
      const deleted = (await manager.query("DELETE FROM login_attempts WHERE scope = 'staff' AND account_id = $1 RETURNING ip", [id])) as unknown[];
      // legacy account-wide counters, in case an old row still locks the account
      await manager.query("UPDATE staff_users SET failed_login_count = 0, locked_until = NULL WHERE id = $1", [id]);
      await manager.query(
        "INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, diff) VALUES ($1, 'system', NULL, 'LOGIN_UNLOCKED_CLI', 'StaffUser', $2, $3)",
        [uuidv7(), id, JSON.stringify({ via: "yarn staff:unlock", clearedRows: deleted.length })],
      );
      return deleted.length;
    });

    if (cleared === null) {
      console.error(`No staff member with email ${email}`);
      process.exit(1);
    }
    console.log(`Login attempts cleared for ${email} (${cleared} row(s)).`);
  } catch (error) {
    console.error("Error unlocking account:", error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

main();
