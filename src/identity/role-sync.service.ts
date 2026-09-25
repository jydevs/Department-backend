import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { Role } from "./entities/role.entity";
import { ROLE_DEFAULTS, type RoleKey } from "./permissions";

/**
 * Keeps the permissions of the SYSTEM roles (is_system = true) equal to ROLE_DEFAULTS on every boot, so new
 * permissions (e.g. `import:*`) reach an already deployed database without re-running `owner:create`. Idempotent:
 * a role is only written when its permission set differs. Custom roles (is_system = false) are never touched.
 * Roles that do not exist yet are left to `owner:create` (which seeds them).
 */
@Injectable()
export class RoleSyncService implements OnModuleInit {
  private readonly logger = new Logger(RoleSyncService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      const repo = this.dataSource.getRepository(Role);
      for (const key of Object.keys(ROLE_DEFAULTS) as RoleKey[]) {
        const role = await repo.findOne({ where: { key, isSystem: true } });
        if (!role) continue;
        const wanted = [...ROLE_DEFAULTS[key]];
        const same = role.permissions.length === wanted.length && [...role.permissions].sort().join(",") === [...wanted].sort().join(",");
        if (same) continue;
        await repo.update({ id: role.id }, { permissions: wanted });
        this.logger.log(`Synchronised permissions of system role "${key}"`);
      }
    } catch (err) {
      // e.g. migrations not applied yet: never block the boot
      this.logger.warn(`Role permission sync skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
