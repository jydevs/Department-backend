import type { DataSource } from "typeorm";
import { Role } from "./entities/role.entity";
import { ROLE_DEFAULTS, type RoleKey } from "./permissions";

const ROLE_NAMES: Record<RoleKey, string> = {
  owner: "Owner",
  admin: "Administrator",
  editor: "Editor",
  fulfillment: "Fulfillment",
  support: "Support",
  analyst: "Analyst",
};

export async function seedRoles(dataSource: DataSource): Promise<void> {
  const roleRepository = dataSource.getRepository(Role);

  for (const roleKey of Object.keys(ROLE_DEFAULTS) as RoleKey[]) {
    const permissions = ROLE_DEFAULTS[roleKey];
    const name = ROLE_NAMES[roleKey];

    await roleRepository.upsert(
      {
        key: roleKey,
        name,
        permissions,
        isSystem: true,
      },
      {
        conflictPaths: ["key"],
        skipUpdateIfNoValuesChanged: true,
      },
    );
  }
}
