import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module";
import { Fulfillment } from "../commerce/entities/fulfillment.entity";
import { Order } from "../commerce/entities/order.entity";
import { OrderLine } from "../commerce/entities/order-line.entity";
import { PasswordService } from "../identity/auth/password.service";
import { MailModule } from "../mail/mail.module";
import { CustomerAuthController } from "./auth/customer-auth.controller";
import { CustomerAuthGuard } from "./auth/customer-auth.guard";
import { CustomerAuthService } from "./auth/customer-auth.service";
import { CustomerTokenService } from "./auth/customer-token.service";
import { CustomerErasureService } from "./customer-erasure.service";
import { CustomersAccountController } from "./customers-account.controller";
import { CustomersAccountService } from "./customers-account.service";
import { CustomersAdminController } from "./customers-admin.controller";
import { CustomersAdminService } from "./customers-admin.service";
import { Customer, CustomerAddress, CustomerRefreshToken, CustomerToken } from "./entities";

/** Storefront customer accounts (auth, self-service, Habeas Data) and the admin customer directory. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerAddress, CustomerRefreshToken, CustomerToken, Order, OrderLine, Fulfillment]),
    DatabaseModule,
    MailModule,
  ],
  controllers: [CustomerAuthController, CustomersAccountController, CustomersAdminController],
  providers: [
    PasswordService,
    CustomerTokenService,
    CustomerAuthGuard,
    CustomerAuthService,
    CustomerErasureService,
    CustomersAccountService,
    CustomersAdminService,
  ],
  exports: [CustomerAuthGuard, CustomerTokenService],
})
export class CustomersModule {}
