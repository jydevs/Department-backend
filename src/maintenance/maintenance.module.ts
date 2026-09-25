import { Module } from "@nestjs/common";
import { CustomersModule } from "../customers/customers.module";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceService } from "./maintenance.service";

/** Hourly housekeeping (retention purges + Habeas Data order anonymization). Register it in AppModule. */
@Module({
  imports: [CustomersModule],
  providers: [MaintenanceService],
  controllers: [MaintenanceController],
})
export class MaintenanceModule {}
