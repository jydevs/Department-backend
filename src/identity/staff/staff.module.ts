import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StaffUser, Role, RefreshToken } from "../entities";
import { StaffService } from "./staff.service";
import { StaffController } from "./staff.controller";
import { RolesController } from "./roles.controller";
import { AuditModule } from "../../audit/audit.module";
import { DatabaseModule } from "../../database/database.module";

@Module({
  imports: [TypeOrmModule.forFeature([StaffUser, Role, RefreshToken]), AuditModule, DatabaseModule],
  providers: [StaffService],
  controllers: [StaffController, RolesController],
  exports: [StaffService],
})
export class StaffModule {}
