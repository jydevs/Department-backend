import "reflect-metadata";
import { DataSource } from "typeorm";
import { hash } from "argon2";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { buildDbOptions } from "../src/database/db-options";
import { StaffUser } from "../src/identity/entities";

async function main() {
  loadDotEnv();
  const env = loadEnv();
  const dataSource = new DataSource(buildDbOptions(env));
  await dataSource.initialize();

  const email = "jy.devs1@gmail.com";
  const password = "Jolier0211*";

  const passwordHash = await hash(password, {
    type: 2, // argon2id
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const staffRepo = dataSource.getRepository(StaffUser);
  const owner = await staffRepo.findOne({ where: { email } });
  if (owner) {
    owner.passwordHash = passwordHash;
    owner.isActive = true;
    await staffRepo.save(owner);
    console.log(`[OK] Owner password updated for: ${email}`);
  } else {
    console.error("Owner user not found");
  }

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
