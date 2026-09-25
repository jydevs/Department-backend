import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DataSource, EntityManager, Repository } from "typeorm";
import { Clock } from "../../common/clock/clock";
import { RequestContextStore } from "../../common/context/request-context";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { AuditService } from "../../audit/audit.service";
import { TransactionService } from "../../database/transaction.service";
import { RefreshToken, Role, StaffUser } from "../entities";
import { PasswordService } from "./password.service";
import { TokenService, type JWTPayload } from "./token.service";
import { TOTPService } from "./totp.service";

const RECOVERY_CODE_COUNT = 8;

/**
 * Core authentication logic: login, logout, 2FA, password changes, token rotation.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly staffUserRepo: Repository<StaffUser>;
  private readonly refreshTokenRepo: Repository<RefreshToken>;
  private readonly roleRepo: Repository<Role>;
  private dummyHash: string | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly totpService: TOTPService,
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.staffUserRepo = dataSource.getRepository(StaffUser);
    this.refreshTokenRepo = dataSource.getRepository(RefreshToken);
    this.roleRepo = dataSource.getRepository(Role);
  }

  /**
   * Authenticate a user with email, password, and optional TOTP.
   * Locks account after 5 failed attempts for 15 minutes.
   * Returns access token, expiry, and user info.
   */
  async login(
    email: string,
    password: string,
    totp?: string,
  ): Promise<{ accessToken: string; expiresIn: number; refreshToken: string; user: { id: string; email: string; fullName: string; role: string } }> {
    const now = this.clock.now();
    const user = await this.staffUserRepo.findOne({
      where: { email: email.toLowerCase() },
      relations: { role: true },
    });

    // Timing-safe comparison against dummy hash if user doesn't exist
    const passwordHash = user?.passwordHash ?? (await this.getDummyHash());
    const passwordValid = user && (await this.passwordService.verify(password, passwordHash));

    if (!user || !passwordValid) {
      await this.recordFailedLogin(user, now);
      throw AppException.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > now) {
      throw AppException.unauthorized("Account is temporarily locked", "INVALID_CREDENTIALS");
    }

    // Check if 2FA is required
    if (user.totpEnabled && !totp) {
      throw AppException.unauthorized("Two-factor authentication required", "TWO_FACTOR_REQUIRED");
    }

    // Verify TOTP if enabled
    if (user.totpEnabled && totp) {
      const totpValid = await this.totpService.verifyCode(totp, user.totpSecretEnc!);
      if (!totpValid) {
        await this.recordFailedLogin(user, now);
        throw AppException.unauthorized("Invalid two-factor code", "INVALID_CREDENTIALS");
      }
    }

    // Success: reset failed attempts, generate tokens
    await this.transactionService.run(async (manager) => {
      await manager.update(StaffUser, { id: user.id }, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now });

      // Record successful login in audit
      await this.recordAudit({
        action: "LOGIN_SUCCESS",
        entityType: "StaffUser",
        entityId: user.id,
        manager,
      });
    });

    // Generate tokens
    const { token: accessToken, expiresIn } = await this.tokenService.generateAccessToken({
      sub: user.id,
      role: user.role!.key,
    });

    const { token: refreshToken, hash: refreshHash } = this.tokenService.generateRefreshToken();

    // Store refresh token
    const familyId = randomUUID(); // each login starts its own family, so reuse detection only kills that session
    const context = RequestContextStore.get();
    await this.refreshTokenRepo.insert({
      staffUserId: user.id,
      familyId,
      tokenHash: refreshHash,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
      userAgent: context?.userAgent ?? null,
      ip: context?.ip ?? null,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(expiresIn / 1000),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role!.key,
      },
    };
  }

  /**
   * Rotate refresh token. Detects token reuse (entire family is revoked).
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number; refreshToken: string }> {
    const hash = this.tokenService.hashRefreshToken(refreshToken);
    const token = await this.refreshTokenRepo.findOne({
      where: { tokenHash: hash },
      relations: { staffUser: { role: true } },
    });

    if (!token || token.revokedAt) {
      throw AppException.unauthorized("Invalid refresh token", "UNAUTHORIZED");
    }

    const now = this.clock.now();
    if (token.expiresAt < now) {
      throw AppException.unauthorized("Refresh token expired", "UNAUTHORIZED");
    }

    const staffUser = token.staffUser!;

    // Check if token was replaced (reuse detection)
    if (token.replacedById) {
      // Token family is compromised; revoke entire family
      await this.refreshTokenRepo.update(
        { familyId: token.familyId },
        { revokedAt: now },
      );

      throw AppException.unauthorized("Token reuse detected; all sessions revoked", "UNAUTHORIZED");
    }

    // Rotate the token
    const { token: newRefreshToken, hash: newHash } = this.tokenService.generateRefreshToken();

    await this.transactionService.run(async (manager) => {
      // Mark old token as replaced
      await manager.update(RefreshToken, { id: token.id }, { replacedById: token.id, revokedAt: now });

      // Insert new token in same family
      const newToken = manager.create(RefreshToken, {
        staffUserId: staffUser.id,
        familyId: token.familyId,
        tokenHash: newHash,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        userAgent: token.userAgent,
        ip: token.ip,
      });
      await manager.save(newToken);

      await this.recordAudit({
        action: "TOKEN_REFRESH",
        entityType: "RefreshToken",
        entityId: token.id,
        manager,
      });
    });

    // Return new access token
    const { token: accessToken, expiresIn } = await this.tokenService.generateAccessToken({
      sub: staffUser.id,
      role: staffUser.role!.key,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: Math.floor(expiresIn / 1000),
    };
  }

  /**
   * Logout: revoke all refresh tokens for this user.
   */
  async logout(staffUserId: string): Promise<void> {
    const now = this.clock.now();

    await this.transactionService.run(async (manager) => {
      await manager.update(RefreshToken, { staffUserId }, { revokedAt: now });

      await this.recordAudit({
        action: "LOGOUT",
        entityType: "StaffUser",
        entityId: staffUserId,
        manager,
      });
    });

  }

  /**
   * Initialize 2FA setup: return otpauth URI and encrypted secret.
   */
  async setupTwoFA(staffUserId: string): Promise<{ otpauthUrl: string; secret: string }> {
    const user = await this.staffUserRepo.findOneBy({ id: staffUserId });
    if (!user) {
      throw AppException.notFound("User");
    }

    const { secret, uri } = this.totpService.generateSecret(user.email);

    return {
      otpauthUrl: uri,
      secret,
    };
  }

  /**
   * Enable 2FA: verify code and generate recovery codes.
   */
  async enableTwoFA(staffUserId: string, code: string, encryptedSecret: string): Promise<string[]> {
    const user = await this.staffUserRepo.findOneBy({ id: staffUserId });
    if (!user) {
      throw AppException.notFound("User");
    }

    // Verify the code
    const valid = this.totpService.verifyCode(code, encryptedSecret);
    if (!valid) {
      throw AppException.badRequest("INVALID_OTP", "Invalid verification code");
    }

    // Generate recovery codes
    const recoveryCodes = this.generateRecoveryCodes(RECOVERY_CODE_COUNT);
    const recoveryCodesHash = await Promise.all(
      recoveryCodes.map((c) => this.passwordService.hash(c)),
    );

    await this.transactionService.run(async (manager) => {
      await manager.update(StaffUser, { id: staffUserId }, {
        totpSecretEnc: encryptedSecret,
        totpEnabled: true,
        recoveryCodesHash,
      });

      await this.recordAudit({
        action: "2FA_ENABLED",
        entityType: "StaffUser",
        entityId: staffUserId,
        manager,
      });
    });

    return recoveryCodes;
  }

  /**
   * Disable 2FA: verify password and TOTP code, then clear settings.
   */
  async disableTwoFA(staffUserId: string, password: string, code: string): Promise<void> {
    const user = await this.staffUserRepo.findOneBy({ id: staffUserId });
    if (!user) {
      throw AppException.notFound("User");
    }

    // Verify password
    const passwordValid = await this.passwordService.verify(password, user.passwordHash);
    if (!passwordValid) {
      throw AppException.unauthorized("Invalid password", "INVALID_CREDENTIALS");
    }

    // Verify TOTP code
    if (!user.totpSecretEnc) {
      throw AppException.badRequest("2FA_NOT_ENABLED", "Two-factor authentication is not enabled");
    }

    const totpValid = await this.totpService.verifyCode(code, user.totpSecretEnc);
    if (!totpValid) {
      throw AppException.badRequest("INVALID_OTP", "Invalid verification code");
    }

    await this.transactionService.run(async (manager) => {
      await manager.update(StaffUser, { id: staffUserId }, {
        totpSecretEnc: null,
        totpEnabled: false,
        recoveryCodesHash: [],
      });

      await this.recordAudit({
        action: "2FA_DISABLED",
        entityType: "StaffUser",
        entityId: staffUserId,
        manager,
      });
    });
  }

  /**
   * Change password: verify current password, update hash, revoke all refresh token families.
   */
  async changePassword(staffUserId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.staffUserRepo.findOneBy({ id: staffUserId });
    if (!user) {
      throw AppException.notFound("User");
    }

    // Verify current password
    const valid = await this.passwordService.verify(currentPassword, user.passwordHash);
    if (!valid) {
      throw AppException.unauthorized("Current password is incorrect", "INVALID_CREDENTIALS");
    }

    const newHash = await this.passwordService.hash(newPassword);
    const now = this.clock.now();

    await this.transactionService.run(async (manager) => {
      // Update password and increment version
      await manager.update(StaffUser, { id: staffUserId }, {
        passwordHash: newHash,
        version: () => "version + 1", // increment optimistic lock
      });

      // Revoke all refresh tokens (force re-login on all devices)
      await manager.update(RefreshToken, { staffUserId }, { revokedAt: now });

      await this.recordAudit({
        action: "PASSWORD_CHANGED",
        entityType: "StaffUser",
        entityId: staffUserId,
        manager,
      });
    });
  }

  /**
   * Get user info with permissions.
   */
  async getUserWithPermissions(
    staffUserId: string,
  ): Promise<{ id: string; email: string; fullName: string; role: string; permissions: string[]; totpEnabled: boolean }> {
    const user = await this.staffUserRepo.findOne({
      where: { id: staffUserId },
      relations: { role: true },
    });

    if (!user || !user.isActive) {
      throw AppException.unauthorized("User not found or inactive", "UNAUTHORIZED");
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role!.key,
      permissions: user.role!.permissions,
      totpEnabled: user.totpEnabled,
    };
  }

  /**
   * Verify access token and get payload.
   */
  async verifyAccessToken(token: string): Promise<JWTPayload | null> {
    return this.tokenService.verifyAccessToken(token);
  }

  /**
   * Record failed login attempt and lock account if necessary.
   */
  private async recordFailedLogin(user: StaffUser | null, now: Date): Promise<void> {
    if (!user) return;

    const newCount = user.failedLoginCount + 1;
    const update: Partial<StaffUser> = { failedLoginCount: newCount };

    // Lock for 15 minutes after 5 failed attempts
    if (newCount >= 5) {
      update.lockedUntil = new Date(now.getTime() + 15 * 60 * 1000);
    }

    await this.staffUserRepo.update({ id: user.id }, update);

    if (this.env.NODE_ENV !== "test") {
      await this.recordAudit({
        action: "LOGIN_FAILED",
        entityType: "StaffUser",
        entityId: user.id,
      });
    }
  }

  /**
   * Get a dummy hash for timing-safe comparison when user not found.
   */
  private async getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = await this.passwordService.hash("dummy-password-for-timing-safety");
    }
    return this.dummyHash;
  }

  /**
   * Generate recovery codes (8 codes, 8 characters each, alphanumeric).
   */
  private generateRecoveryCodes(count: number): string[] {
    const codes: string[] = [];
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (let i = 0; i < count; i++) {
      let code = "";
      for (let j = 0; j < 8; j++) {
        code += charset.charAt(Math.floor(Math.random() * charset.length));
      }
      codes.push(code);
    }
    return codes;
  }

  /**
   * Record action in audit log via AuditService.
   */
  private async recordAudit(input: {
    action: string;
    entityType: string;
    entityId?: string;
    diff?: Record<string, unknown>;
    manager?: EntityManager;
  }): Promise<void> {
    await this.auditService.record(
      {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        diff: input.diff,
      },
      input.manager,
    );
  }
}
