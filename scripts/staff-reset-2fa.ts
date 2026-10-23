import "reflect-metadata";
import { DataSource } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { buildDbOptions } from "../src/database/db-options";

/**
 * Break-glass recovery for a staff member who lost BOTH the authenticator and the recovery codes:
 *   yarn staff:reset-2fa <email>
 * Turns 2FA off (secret, replay step and recovery codes wiped), forces a password change at the next login
 * (must_change_password), revokes every refresh token and writes an audit row with actor `system`.
 * It only runs with database access (the operator), never through the API.
 */
async function main() {
  loadDotEnv();
  const env = loadEnv();
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: yarn staff:reset-2fa <email>");
    process.exit(1);
  }

  const dataSource = new DataSource(buildDbOptions(env));
  try {
    await dataSource.initialize();
    const reset = await dataSource.transaction(async (manager) => {
      const rows = (await manager.query("SELECT id FROM staff_users WHERE email = $1 FOR UPDATE", [email])) as Array<{ id: string }>;
      const id = rows[0]?.id;
      if (!id) return null;
      await manager.query(
        `UPDATE staff_users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, totp_setup_at = NULL,
           recovery_codes_hash = '{}', must_change_password = true, version = version + 1 WHERE id = $1`,
        [id],
      );
      await manager.query("UPDATE refresh_tokens SET revoked_at = now() WHERE staff_user_id = $1 AND revoked_at IS NULL", [id]);
      await manager.query(
        "INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, diff) VALUES ($1, 'system', NULL, '2FA_RESET_CLI', 'StaffUser', $2, $3)",
        [uuidv7(), id, JSON.stringify({ via: "yarn staff:reset-2fa" })],
      );
      return id;
    });

    if (!reset) {
      console.error(`No staff member with email ${email}`);
      process.exit(1);
    }
    console.log(`2FA reset for ${email}: sessions revoked, password change required at next login. Run \`yarn staff:unlock ${email}\` if the account is also locked.`);
  } catch (error) {
    console.error("Error resetting 2FA:", error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

main();
