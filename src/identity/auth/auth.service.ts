import { randomInt, randomUUID } from "node:crypto";
import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { DataSource, EntityManager, IsNull, Repository } from "typeorm";
import { Clock } from "../../common/clock/clock";
import { RequestContextStore } from "../../common/context/request-context";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { AuditService } from "../../audit/audit.service";
import { TransactionService } from "../../database/transaction.service";
import { RefreshToken, StaffUser } from "../entities";
import { PasswordService } from "./password.service";
import { TokenService, type JWTPayload } from "./token.service";
import { TOTPService } from "./totp.service";

const RECOVERY_CODE_COUNT = 8;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

/**
 * Core authentication logic: login, logout, 2FA, password changes, token rotation.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly staffUserRepo: Repository<StaffUser>;
  private readonly refreshTokenRepo: Repository<RefreshToken>;
  private dummyHash = "";

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
  }

  /** Hash once at boot so unknown-email logins cost the same as real ones. */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.passwordService.hash("dummy-password-for-timing-safety");
  }

  /**
   * Authenticate with email + password (+ TOTP or a recovery code when 2FA is on).
   * Every rejection (unknown email, bad password, inactive, locked, bad code) looks the same to the caller.
   */
  async login(
    email: string,
    password: string,
    totp?: string,
  ): Promise<{ accessToken: string; expiresIn: number; refreshToken: string; user: { id: string; email: string; fullName: string; role: string } }> {
    const now = this.clock.now();
    const user = await this.staffUserRepo.findOne({ where: { email: email.toLowerCase() }, relations: { role: true } });

    // always run argon2, even for unknown emails, so timing does not reveal which emails exist
    const passwordOk = await this.passwordService.verify(password, user?.passwordHash ?? this.dummyHash);
    const locked = !!user?.lockedUntil && user.lockedUntil > now;

    if (!user || !passwordOk || !user.isActive || locked) {
      // a locked account is not touched again: attackers must not be able to extend the lock forever
      if (user && user.isActive && !locked) await this.recordFailedLogin(user.id, now);
      else if (!user) await this.recordAudit({ action: "LOGIN_FAILED", entityType: "StaffUser" });
      throw AppException.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
    }

    if (user.totpEnabled) {
      if (!totp) throw AppException.unauthorized("Two-factor authentication required", "TWO_FACTOR_REQUIRED");
      const ok = /^\d{6}$/.test(totp)
        ? await this.totpService.verifyCode(totp, user.totpSecretEnc!)
        : await this.consumeRecoveryCode(user.id, totp);
      if (!ok) {
        await this.recordFailedLogin(user.id, now);
        throw AppException.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
      }
    }

    const { token: refreshToken, hash: refreshHash } = this.tokenService.generateRefreshToken();
    const context = RequestContextStore.get();

    // reset counters, store the session and audit atomically
    await this.transactionService.run(async (manager) => {
      await manager.update(StaffUser, { id: user.id }, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now });
      await manager.insert(RefreshToken, {
        id: uuidv7(),
        staffUserId: user.id,
        familyId: randomUUID(), // each login is its own family: reuse detection only kills that session
        tokenHash: refreshHash,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
        userAgent: context?.userAgent ?? null,
        ip: context?.ip ?? null,
      });
      await this.recordAudit({ action: "LOGIN_SUCCESS", entityType: "StaffUser", entityId: user.id, manager });
    });

    const { token: accessToken, expiresIn } = await this.tokenService.generateAccessToken({ sub: user.id, role: user.role!.key });
    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(expiresIn / 1000),
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role!.key },
    };
  }

  /**
   * Rotate a refresh token. The row is locked for the whole rotation, so two simultaneous requests with the
   * same cookie cannot both succeed. Presenting an already-rotated token means it leaked: the whole family dies.
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number; refreshToken: string }> {
    const hash = this.tokenService.hashRefreshToken(refreshToken);
    const now = this.clock.now();

    const outcome = await this.transactionService.run(async (manager) => {
      const token = await manager.findOne(RefreshToken, { where: { tokenHash: hash }, lock: { mode: "pessimistic_write" } });
      if (!token) return { kind: "invalid" as const };

      if (token.revokedAt) {
        if (token.replacedById) {
          await manager.update(RefreshToken, { familyId: token.familyId, revokedAt: IsNull() }, { revokedAt: now });
          await this.recordAudit({ action: "TOKEN_REUSE_DETECTED", entityType: "StaffUser", entityId: token.staffUserId, manager });
          return { kind: "reuse" as const };
        }
        return { kind: "invalid" as const };
      }
      if (token.expiresAt <= now) return { kind: "invalid" as const };

      const user = await manager.findOne(StaffUser, { where: { id: token.staffUserId }, relations: { role: true } });
      if (!user || !user.isActive) return { kind: "invalid" as const };

      const next = this.tokenService.generateRefreshToken();
      const nextId = uuidv7();
      await manager.update(RefreshToken, { id: token.id }, { revokedAt: now, replacedById: nextId });
      await manager.insert(RefreshToken, {
        id: nextId,
        staffUserId: user.id,
        familyId: token.familyId,
        tokenHash: next.hash,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
        userAgent: token.userAgent,
        ip: token.ip,
      });
      await this.recordAudit({ action: "TOKEN_REFRESH", entityType: "RefreshToken", entityId: token.id, manager });
      return { kind: "ok" as const, user, refreshToken: next.token };
    });

    // thrown outside the transaction so the family revocation above is committed
    if (outcome.kind !== "ok") throw AppException.unauthorized("Invalid refresh token", "UNAUTHORIZED");

    const { token: accessToken, expiresIn } = await this.tokenService.generateAccessToken({
      sub: outcome.user.id,
      role: outcome.user.role!.key,
    });
    return { accessToken, refreshToken: outcome.refreshToken, expiresIn: Math.floor(expiresIn / 1000) };
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
   * Start 2FA enrolment: the new secret is stored server-side (pending, totpEnabled=false) and only the
   * otpauth URI goes to the client. Nothing the client sends later can choose the secret.
   */
  async setupTwoFA(staffUserId: string): Promise<{ otpauthUrl: string }> {
    const user = await this.staffUserRepo.findOneBy({ id: staffUserId });
    if (!user) throw AppException.notFound("User");
    if (user.totpEnabled) throw AppException.conflict("2FA_ALREADY_ENABLED", "Two-factor authentication is already enabled");

    const { secret, uri } = this.totpService.generateSecret(user.email);
    await this.staffUserRepo.update({ id: staffUserId }, { totpSecretEnc: secret });
    return { otpauthUrl: uri };
  }

  /** Finish enrolment: needs the current password AND a valid code for the pending secret. */
  async enableTwoFA(staffUserId: string, password: string, code: string): Promise<string[]> {
    const user = await this.staffUserRepo.findOneBy({ id: staffUserId });
    if (!user) throw AppException.notFound("User");
    if (user.totpEnabled) throw AppException.conflict("2FA_ALREADY_ENABLED", "Two-factor authentication is already enabled");
    if (!user.totpSecretEnc) throw AppException.badRequest("2FA_NOT_STARTED", "Start the setup first");

    if (!(await this.passwordService.verify(password, user.passwordHash))) {
      throw AppException.unauthorized("Invalid password", "INVALID_CREDENTIALS");
    }
    if (!(await this.totpService.verifyCode(code, user.totpSecretEnc))) {
      throw AppException.badRequest("INVALID_OTP", "Invalid verification code");
    }

    const recoveryCodes = this.generateRecoveryCodes(RECOVERY_CODE_COUNT);
    const recoveryCodesHash = await Promise.all(recoveryCodes.map((c) => this.passwordService.hash(c)));

    await this.transactionService.run(async (manager) => {
      await manager.update(StaffUser, { id: staffUserId }, { totpEnabled: true, recoveryCodesHash });
      await this.recordAudit({ action: "2FA_ENABLED", entityType: "StaffUser", entityId: staffUserId, manager });
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
   * Count a failed attempt in ONE atomic statement (parallel guesses cannot undercount) and lock after 5.
   * An expired lock restarts the count at 1 instead of re-locking on the very next miss.
   */
  private async recordFailedLogin(userId: string, now: Date): Promise<void> {
    const next = "CASE WHEN locked_until IS NOT NULL AND locked_until <= $2 THEN 1 ELSE failed_login_count + 1 END";
    await this.dataSource.query(
      `UPDATE staff_users SET failed_login_count = ${next}, locked_until = CASE WHEN (${next}) >= ${MAX_FAILED_LOGINS} THEN $3::timestamptz ELSE NULL END WHERE id = $1`,
      [userId, now, new Date(now.getTime() + LOCK_MS)],
    );
    await this.recordAudit({ action: "LOGIN_FAILED", entityType: "StaffUser", entityId: userId });
  }

  /** One-time recovery code as a second factor: verified against the argon2 hashes and removed atomically. */
  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    return this.transactionService.run(async (manager) => {
      const user = await manager.findOne(StaffUser, { where: { id: userId }, lock: { mode: "pessimistic_write" } });
      if (!user) return false;
      for (let i = 0; i < user.recoveryCodesHash.length; i++) {
        if (await this.passwordService.verify(code, user.recoveryCodesHash[i]!)) {
          const remaining = user.recoveryCodesHash.filter((_, idx) => idx !== i);
          await manager.update(StaffUser, { id: userId }, { recoveryCodesHash: remaining });
          await this.recordAudit({ action: "RECOVERY_CODE_USED", entityType: "StaffUser", entityId: userId, manager });
          return true;
        }
      }
      return false;
    });
  }

  /** 8 codes of 8 characters from a CSPRNG (no ambiguous characters). */
  private generateRecoveryCodes(count: number): string[] {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: count }, () => Array.from({ length: 8 }, () => charset[randomInt(charset.length)]).join(""));
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
