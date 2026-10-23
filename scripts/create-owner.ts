import "reflect-metadata";
import { DataSource } from "typeorm";
import { hash } from "argon2";
import { v7 as uuidv7 } from "uuid";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { buildDbOptions } from "../src/database/db-options";
import { StaffUser, Role } from "../src/identity/entities";
import { seedRoles } from "../src/identity/identity.seed";

async function main() {
  loadDotEnv();
  const env = loadEnv();

  const email = env.OWNER_EMAIL?.toLowerCase();
  const password = env.OWNER_PASSWORD;

  if (!email || !password) {
    console.error("Error: OWNER_EMAIL and OWNER_PASSWORD environment variables are required");
    process.exit(1);
  }

  if (password.length < 12 || password.length > 256) {
    console.error("Error: OWNER_PASSWORD must be between 12 and 256 characters");
    process.exit(1);
  }

  const dataSource = new DataSource(buildDbOptions(env));

  try {
    await dataSource.initialize();
    console.log("Connected to database");

    await seedRoles(dataSource);
    console.log("Seeded roles");

    const roleRepository = dataSource.getRepository(Role);
    const staffRepository = dataSource.getRepository(StaffUser);

    const ownerRole = await roleRepository.findOne({ where: { key: "owner" } });
    if (!ownerRole) {
      console.error("Error: Owner role not found");
      process.exit(1);
    }

    const existingOwner = await staffRepository.findOne({ where: { email } });
    if (existingOwner) {
      console.log(`Owner with email ${email} already exists`);
      process.exit(0);
    }

    const passwordHash = await hash(password, {
      type: 2, // argon2id
      memoryCost: 19456, // 19 MiB
      timeCost: 2,
      parallelism: 1,
    });

    const owner = new StaffUser();
    owner.id = uuidv7();
    owner.email = email;
    owner.fullName = "Owner";
    owner.passwordHash = passwordHash;
    owner.roleId = ownerRole.id;
    owner.isActive = true;
    owner.mustChangePassword = env.OWNER_MUST_CHANGE_PASSWORD;

    await staffRepository.save(owner);
    console.log(`Owner created successfully with email: ${email}`);
  } catch (error) {
    console.error("Error creating owner:", error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

main();
