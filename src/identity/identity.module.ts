import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { RoleSyncService } from "./role-sync.service";
import { StaffModule } from "./staff/staff.module";

@Module({ imports: [AuthModule, StaffModule], providers: [RoleSyncService], exports: [AuthModule] })
export class IdentityModule {}
