import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ClockModule } from "../../common/clock/clock";
import { DatabaseModule } from "../../database/database.module";
import { RefreshToken, Role, StaffUser } from "../entities";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { PasswordService } from "./password.service";
import { PermissionsGuard } from "./permissions.guard";
import { TokenService } from "./token.service";
import { TOTPService } from "./totp.service";

/**
 * Authentication module: services, guards, and controller.
 * Exports AuthService, AuthGuard, PermissionsGuard for use in the identity module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StaffUser, Role, RefreshToken]),
    ClockModule,
    DatabaseModule,
  ],
  providers: [
    PasswordService,
    TokenService,
    TOTPService,
    AuthService,
    AuthGuard,
    PermissionsGuard,
  ],
  controllers: [AuthController],
  exports: [AuthService, AuthGuard, PermissionsGuard],
})
export class AuthModule {}
