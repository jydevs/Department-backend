import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { StaffModule } from "./staff/staff.module";

@Module({ imports: [AuthModule, StaffModule] })
export class IdentityModule {}
