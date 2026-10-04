import "reflect-metadata";
import { DataSource } from "typeorm";
import { hash } from "argon2";
import { v7 as uuidv7 } from "uuid";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { buildDbOptions } from "../src/database/db-options";
import { Customer } from "../src/customers/entities/customer.entity";

async function main() {
  loadDotEnv();
  const env = loadEnv();
  const dataSource = new DataSource(buildDbOptions(env));
  await dataSource.initialize();
  
  const email = (process.env.CUSTOMER_EMAIL || "jy.devs1@gmail.com").toLowerCase();
  const password = process.env.CUSTOMER_PASSWORD || "Jolier0211*";
  const firstName = process.env.CUSTOMER_FIRST_NAME || "Jolie";
  const lastName = process.env.CUSTOMER_LAST_NAME || "Dev";

  const passwordHash = await hash(password, {
    type: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const customerRepo = dataSource.getRepository(Customer);
  let customer = await customerRepo.findOne({ where: { email } });

  if (customer) {
    customer.passwordHash = passwordHash;
    customer.isActive = true;
    customer.emailVerifiedAt = new Date();
    await customerRepo.save(customer);
    console.log(`[OK] Customer password updated for: ${email}`);
  } else {
    customer = new Customer();
    customer.id = uuidv7();
    customer.email = email;
    customer.firstName = firstName;
    customer.lastName = lastName;
    customer.passwordHash = passwordHash;
    customer.isActive = true;
    customer.emailVerifiedAt = new Date();
    customer.version = 1;
    await customerRepo.save(customer);
    console.log(`[OK] Customer created successfully: ${email}`);
  }

  await dataSource.destroy();
}

main().catch((e) => {
  console.error("Error creating customer:", e);
  process.exit(1);
});
