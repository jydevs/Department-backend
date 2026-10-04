import "reflect-metadata";
import { DataSource } from "typeorm";
import { hash } from "argon2";
import { v7 as uuidv7 } from "uuid";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { buildDbOptions } from "../src/database/db-options";
import { StaffUser, Role } from "../src/identity/entities";
import { seedRoles } from "../src/identity/identity.seed";
import { Customer } from "../src/customers/entities/customer.entity";
import { CustomerAddress } from "../src/customers/entities/customer-address.entity";

async function main() {
  loadDotEnv();
  const env = loadEnv();
  const dataSource = new DataSource(buildDbOptions(env));

  try {
    await dataSource.initialize();
    console.log("✔ Conectado a la base de datos PostgreSQL.");

    // 1. Sembrar Roles del Sistema
    await seedRoles(dataSource);
    console.log("✔ Roles del sistema verificados / sembrados.");

    const roleRepo = dataSource.getRepository(Role);
    const staffRepo = dataSource.getRepository(StaffUser);
    const customerRepo = dataSource.getRepository(Customer);
    const addressRepo = dataSource.getRepository(CustomerAddress);

    const ownerRole = await roleRepo.findOne({ where: { key: "owner" } });
    if (!ownerRole) {
      throw new Error("No se encontró el rol de owner");
    }

    // 2. Sembrar / Actualizar Usuario Staff Owner
    const ownerEmail = (env.OWNER_EMAIL || "jy.devs1@gmail.com").toLowerCase();
    const ownerPassword = env.OWNER_PASSWORD || "Jolier0211*";
    const ownerHash = await hash(ownerPassword, {
      type: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    let owner = await staffRepo.findOne({ where: { email: ownerEmail } });
    if (owner) {
      owner.passwordHash = ownerHash;
      owner.roleId = ownerRole.id;
      owner.isActive = true;
      await staffRepo.save(owner);
      console.log(`✔ Usuario Staff Owner actualizado: ${ownerEmail}`);
    } else {
      owner = staffRepo.create({
        id: uuidv7(),
        email: ownerEmail,
        fullName: "Owner Principal",
        passwordHash: ownerHash,
        roleId: ownerRole.id,
        isActive: true,
      });
      await staffRepo.save(owner);
      console.log(`✔ Usuario Staff Owner creado: ${ownerEmail}`);
    }

    // 3. Sembrar / Actualizar 1 Cliente de prueba para la Tienda (Storefront Customer)
    const customerEmail = "cliente@dept.test";
    const customerPassword = "Cliente123*";
    const customerHash = await hash(customerPassword, {
      type: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    let customer = await customerRepo.findOne({ where: { email: customerEmail } });
    if (customer) {
      customer.passwordHash = customerHash;
      customer.isActive = true;
      customer.emailVerifiedAt = new Date();
      await customerRepo.save(customer);
      console.log(`✔ Cliente de tienda actualizado: ${customerEmail}`);
    } else {
      customer = customerRepo.create({
        id: uuidv7(),
        email: customerEmail,
        firstName: "Carlos",
        lastName: "Cliente",
        phone: "+573001234567",
        passwordHash: customerHash,
        acceptsMarketing: true,
        emailVerifiedAt: new Date(),
        isActive: true,
        version: 1,
      });
      customer = await customerRepo.save(customer);
      console.log(`✔ Cliente de tienda creado: ${customerEmail}`);

      // Agregar dirección por defecto al cliente
      const address = addressRepo.create({
        id: uuidv7(),
        customerId: customer.id,
        label: "Casa",
        isDefault: true,
        fullName: "Carlos Cliente",
        phone: "+573001234567",
        department: "Bogotá D.C.",
        city: "Bogotá D.C.",
        address1: "Calle 100 # 15-20",
        address2: "Apto 501",
        postalCode: "110111",
        documentType: "CC",
        documentNumber: "1234567890",
      });
      await addressRepo.save(address);
      console.log(`✔ Dirección por defecto creada para ${customerEmail}`);
    }

    console.log("\n========================================================");
    console.log("         ¡SEED DE LA BASE DE DATOS COMPLETADO!         ");
    console.log("========================================================");
    console.log("👤 CUENTA OWNER / ADMIN:");
    console.log(`   - Email:       ${ownerEmail}`);
    console.log(`   - Contraseña:  ${ownerPassword}`);
    console.log(`   - Acceso:      http://localhost:3000/admin/login`);
    console.log("--------------------------------------------------------");
    console.log("🛒 CUENTA CLIENTE STOREFRONT:");
    console.log(`   - Email:       ${customerEmail}`);
    console.log(`   - Contraseña:  ${customerPassword}`);
    console.log(`   - Acceso:      http://localhost:3000/account/login`);
    console.log("========================================================\n");
  } catch (error) {
    console.error("❌ Error ejecutando el seed:", error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

main();
