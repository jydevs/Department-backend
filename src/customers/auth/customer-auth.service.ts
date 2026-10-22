import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, IsNull, Repository } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { Clock } from "../../common/clock/clock";
import { RequestContextStore } from "../../common/context/request-context";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { AuditService } from "../../audit/audit.service";
import { TransactionService } from "../../database/transaction.service";
import { PasswordService } from "../../identity/auth/password.service";
import { MailService } from "../../mail/mail.service";
import type { CustomerLoginResponse, CustomerRefreshResponse, RegisterInput } from "../dto/customers.dto";
import { Customer, CustomerRefreshToken } from "../entities";
import { isEmailSuppressed, linkGuestOrders, queryRows, recordFailedPassword, toProfile } from "../customers-support";
import { CustomerTokenService } from "./customer-token.service";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;
/** No second link of the same type is issued while an unused one younger than this exists (anti mail-bombing). */
const TOKEN_COOLDOWN_MS = 2 * 60 * 1000;

type OneTimeTokenType = "password_reset" | "email_verify";

/**
 * Storefront customer authentication. Same security model as the staff AuthService:
 * constant-time login, atomic lockout, rotating refresh tokens with reuse detection.
 */
@Injectable()
export class CustomerAuthService implements OnModuleInit {
  private readonly logger = new Logger(CustomerAuthService.name);
  private dummyHash = "";

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly passwords: PasswordService,
    private readonly tokens: CustomerTokenService,
    private readonly transactions: TransactionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Hash once at boot so unknown-email logins and registrations cost the same as real ones. */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.passwords.hash("dummy-password-for-timing-safety");
  }

  /* ── register ─────────────────────────────────────────── */

  /**
   * Answers immediately and does the real work afterwards, so the response time never depends on whether the
   * email exists (argon2 hashing, inserts and mail all happen after the 202). An existing account is left
   * untouched and its owner gets an "account_exists" mail with a link to the forgot-password page (no token).
   */
  register(input: RegisterInput): void {
    this.defer("register", () => this.performRegister(input));
  }

  private async performRegister(input: RegisterInput): Promise<void> {
    const now = this.clock.now();
    const passwordHash = await this.passwords.hash(input.password);

    await this.transactions.run(async (manager) => {
      // Habeas Data: an erased data subject is not recreated by a registration (still a silent 202, nothing revealed).
      // Limitation: they cannot self-register again until staff delete their row in erasure_suppressions (see docs/API.md).
      if (await isEmailSuppressed(manager, input.email)) return;

      const inserted = await queryRows<{ id: string }>(
        manager,
        `INSERT INTO customers (id, email, password_hash, first_name, last_name, accepts_marketing, marketing_consent_at, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [uuidv7(), input.email, passwordHash, input.firstName, input.lastName, input.acceptsMarketing, input.acceptsMarketing ? now : null],
      );

      const created = inserted[0];
      if (created) {
        const token = await this.issueToken(manager, created.id, "email_verify", VERIFY_TTL_MS, now);
        if (token) {
          await this.mail.enqueue(
            { to: input.email, template: "email_verify", data: { customerName: input.firstName, verifyUrl: this.link("verify-email", token), expiresInHours: 48 } },
            manager,
          );
        }
        return;
      }

      // the address already has an account (it may be a password-less guest created by the importer): tell its owner
      const existing = await queryRows<{ first_name: string }>(
        manager,
        "SELECT first_name FROM customers WHERE email = $1 AND is_active = true AND anonymized_at IS NULL AND deleted_at IS NULL",
        [input.email],
      );
      const owner = existing[0];
      if (!owner) return;
      const recent = await queryRows<{ id: string }>(
        manager,
        "SELECT id FROM email_outbox WHERE \"to\" = $1 AND template = 'account_exists' AND created_at > $2 LIMIT 1",
        [input.email, new Date(now.getTime() - TOKEN_COOLDOWN_MS)],
      );
      if (recent.length > 0) return;
      await this.mail.enqueue(
        {
          to: input.email,
          template: "account_exists",
          data: { customerName: owner.first_name, resetUrl: `${this.env.STOREFRONT_URL.replace(/\/+$/, "")}/account/forgot-password` },
        },
        manager,
      );
    });
  }

  /* ── login / refresh / logout ─────────────────────────── */

  /** Every rejection (unknown email, bad password, inactive, locked, guest) looks the same to the caller. */
  async login(email: string, password: string): Promise<CustomerLoginResponse & { refreshToken: string }> {
    const now = this.clock.now();
    const customer = await this.customers.findOne({ where: { email: email.toLowerCase() } });

    // always run argon2, even for unknown emails, so timing does not reveal which emails exist
    const passwordOk = await this.passwords.verify(password, customer?.passwordHash ?? this.dummyHash);
    const locked = !!customer?.lockedUntil && customer.lockedUntil > now;
    const usable = !!customer && !!customer.passwordHash && customer.isActive && !customer.anonymizedAt;

    if (!customer || !usable || !passwordOk || locked) {
      // a locked account is not touched again: attackers must not be able to extend the lock forever
      if (customer && usable && !locked) await recordFailedPassword(this.dataSource, customer.id, now);
      throw AppException.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
    }

    const refresh = this.tokens.generateOpaque();
    const context = RequestContextStore.get();

    await this.transactions.run(async (manager) => {
      await manager.update(Customer, { id: customer.id }, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now });
      await manager.insert(CustomerRefreshToken, {
        id: uuidv7(),
        customerId: customer.id,
        familyId: randomUUID(), // each login is its own family: reuse detection only kills that session
        tokenHash: refresh.hash,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
        userAgent: context?.userAgent ?? null,
        ip: context?.ip?.slice(0, 45) ?? null,
      });
      if (customer.emailVerifiedAt) await linkGuestOrders(manager, customer.id, customer.email);
    });

    const access = await this.tokens.sign(customer.id);
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: refresh.token, customer: toProfile(customer) };
  }

  /**
   * Rotate a refresh token. The row is locked for the whole rotation, so two simultaneous requests with the
   * same cookie cannot both succeed. Presenting an already-rotated token means it leaked: the whole family dies.
   */
  async refresh(refreshToken: string): Promise<CustomerRefreshResponse & { refreshToken: string }> {
    const hash = this.tokens.hashOpaque(refreshToken);
    const now = this.clock.now();

    const outcome = await this.transactions.run(async (manager) => {
      const token = await manager.findOne(CustomerRefreshToken, { where: { tokenHash: hash }, lock: { mode: "pessimistic_write" } });
      if (!token) return { kind: "invalid" as const };

      if (token.revokedAt) {
        if (token.replacedById) {
          await manager.update(CustomerRefreshToken, { familyId: token.familyId, revokedAt: IsNull() }, { revokedAt: now });
          await this.audit.record({ action: "CUSTOMER_TOKEN_REUSE_DETECTED", entityType: "Customer", entityId: token.customerId }, manager);
          return { kind: "reuse" as const };
        }
        return { kind: "invalid" as const };
      }
      if (token.expiresAt <= now) return { kind: "invalid" as const };

      const customer = await manager.findOne(Customer, { where: { id: token.customerId } });
      if (!customer || !customer.isActive || customer.anonymizedAt) return { kind: "invalid" as const };

      const next = this.tokens.generateOpaque();
      const nextId = uuidv7();
      await manager.update(CustomerRefreshToken, { id: token.id }, { revokedAt: now, replacedById: nextId });
      await manager.insert(CustomerRefreshToken, {
        id: nextId,
        customerId: customer.id,
        familyId: token.familyId,
        tokenHash: next.hash,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
        userAgent: token.userAgent,
        ip: token.ip,
      });
      return { kind: "ok" as const, customerId: customer.id, refreshToken: next.token };
    });

    // thrown outside the transaction so the family revocation above is committed
    if (outcome.kind !== "ok") throw AppException.unauthorized("Invalid refresh token", "UNAUTHORIZED");

    const access = await this.tokens.sign(outcome.customerId);
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: outcome.refreshToken };
  }

  /** Revoke the session (token family) of the cookie. Unknown or missing tokens are ignored: logout never fails. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.dataSource.query(
      `UPDATE customer_refresh_tokens SET revoked_at = $2
        WHERE revoked_at IS NULL
          AND family_id = (SELECT family_id FROM customer_refresh_tokens WHERE token_hash = $1)`,
      [this.tokens.hashOpaque(refreshToken), this.clock.now()],
    );
  }

  /* ── forgot / reset / verify ──────────────────────────── */

  /** Answers immediately (202) and works afterwards: timing cannot reveal whether the account exists. */
  forgotPassword(email: string): void {
    this.defer("forgotPassword", () => this.performForgotPassword(email));
  }

  private async performForgotPassword(email: string): Promise<void> {
    const customer = await this.customers.findOne({ where: { email: email.toLowerCase() } });
    if (!customer || !customer.isActive || customer.anonymizedAt) return;
    const now = this.clock.now();
    await this.transactions.run((manager) => this.sendPasswordReset(manager, customer.id, customer.email, customer.firstName, now));
  }

  /**
   * Resends the verification link. Answers immediately (202) and works afterwards: only an existing, active,
   * still unverified account gets a mail (and never more than one link every 2 minutes).
   */
  resendVerification(email: string): void {
    this.defer("resendVerification", () => this.performResendVerification(email));
  }

  private async performResendVerification(email: string): Promise<void> {
    const customer = await this.customers.findOne({ where: { email: email.toLowerCase() } });
    if (!customer || !customer.isActive || customer.anonymizedAt || customer.emailVerifiedAt) return;
    const now = this.clock.now();
    await this.transactions.run(async (manager) => {
      const token = await this.issueToken(manager, customer.id, "email_verify", VERIFY_TTL_MS, now);
      if (!token) return;
      await this.mail.enqueue(
        { to: customer.email, template: "email_verify", data: { customerName: customer.firstName, verifyUrl: this.link("verify-email", token), expiresInHours: 48 } },
        manager,
      );
    });
  }

  /** Consumes the token atomically (single use), sets the password and kills every session. */
  async resetPassword(token: string, password: string): Promise<void> {
    const now = this.clock.now();
    const newHash = await this.passwords.hash(password);

    await this.transactions.run(async (manager) => {
      const customerId = await this.consumeToken(manager, token, "password_reset", now);
      // a reset link proves the mailbox is theirs: the email counts as verified too
      const updated = await queryRows<{ id: string; email: string }>(
        manager,
        `UPDATE customers
            SET password_hash = $2, failed_login_count = 0, locked_until = NULL,
                email_verified_at = COALESCE(email_verified_at, $3), version = version + 1
          WHERE id = $1 AND is_active = true AND anonymized_at IS NULL AND deleted_at IS NULL
          RETURNING id, email`,
        [customerId, newHash, now],
      );
      const customer = updated[0];
      if (!customer) throw AppException.badRequest("INVALID_TOKEN", "The link is invalid or has expired"); // rolls the token back too

      await manager.query("UPDATE customer_refresh_tokens SET revoked_at = $2 WHERE customer_id = $1 AND revoked_at IS NULL", [customer.id, now]);
      await manager.query(
        "UPDATE customer_tokens SET used_at = $3 WHERE customer_id = $1 AND type = $2 AND used_at IS NULL",
        [customer.id, "password_reset", now],
      );
      await linkGuestOrders(manager, customer.id, customer.email);
      await this.audit.record({ action: "CUSTOMER_PASSWORD_RESET", entityType: "Customer", entityId: customer.id }, manager);
    });
  }

  /**
   * The emailed link proves the mailbox is theirs, NOT that whoever typed the password at registration owns it.
   * So verifying REPLACES the password with the one sent now, kills every session and only then links guest orders.
   */
  async verifyEmail(token: string, password: string): Promise<void> {
    const now = this.clock.now();
    const newHash = await this.passwords.hash(password);

    await this.transactions.run(async (manager) => {
      const customerId = await this.consumeToken(manager, token, "email_verify", now);
      const updated = await queryRows<{ id: string; email: string; first_name: string; was_verified: boolean }>(
        manager,
        `UPDATE customers c
            SET password_hash = $3, failed_login_count = 0, locked_until = NULL,
                email_verified_at = COALESCE(c.email_verified_at, $2), version = c.version + 1
           FROM customers old
          WHERE c.id = $1 AND old.id = c.id AND c.is_active = true AND c.anonymized_at IS NULL AND c.deleted_at IS NULL
          RETURNING c.id, c.email, c.first_name, (old.email_verified_at IS NOT NULL) AS was_verified`,
        [customerId, now, newHash],
      );
      const customer = updated[0];
      if (!customer) throw AppException.badRequest("INVALID_TOKEN", "The link is invalid or has expired");

      await manager.query("UPDATE customer_refresh_tokens SET revoked_at = $2 WHERE customer_id = $1 AND revoked_at IS NULL", [customer.id, now]);
      await manager.query("UPDATE customer_tokens SET used_at = $2 WHERE customer_id = $1 AND used_at IS NULL", [customer.id, now]);
      await linkGuestOrders(manager, customer.id, customer.email);
      await this.audit.record({ action: "CUSTOMER_EMAIL_VERIFIED", entityType: "Customer", entityId: customer.id }, manager);
      if (!customer.was_verified) {
        await this.mail.enqueue({ to: customer.email, template: "welcome", data: { customerName: customer.first_name, storeUrl: this.env.STOREFRONT_URL } }, manager);
      }
    });
  }

  /* ── internals ────────────────────────────────────────── */

  /** Atomic single use: two concurrent requests with the same token cannot both get a row back. */
  private async consumeToken(manager: EntityManager, token: string, type: OneTimeTokenType, now: Date): Promise<string> {
    const rows = await queryRows<{ customer_id: string }>(
      manager,
      `UPDATE customer_tokens SET used_at = $3
        WHERE token_hash = $1 AND type = $2 AND used_at IS NULL AND expires_at > $3
        RETURNING customer_id`,
      [this.tokens.hashOpaque(token), type, now],
    );
    const row = rows[0];
    if (!row) throw AppException.badRequest("INVALID_TOKEN", "The link is invalid or has expired");
    return row.customer_id;
  }

  /**
   * New one-time token; earlier unused tokens of the same type stop working. Stores only the sha256.
   * Returns null (nothing issued) when an unused token of this type was created less than 2 minutes ago.
   */
  private async issueToken(manager: EntityManager, customerId: string, type: OneTimeTokenType, ttlMs: number, now: Date): Promise<string | null> {
    const recent = await queryRows<{ id: string }>(
      manager,
      "SELECT id FROM customer_tokens WHERE customer_id = $1 AND type = $2 AND used_at IS NULL AND created_at > $3 LIMIT 1",
      [customerId, type, new Date(now.getTime() - TOKEN_COOLDOWN_MS)],
    );
    if (recent.length > 0) return null;
    await manager.query("UPDATE customer_tokens SET used_at = $3 WHERE customer_id = $1 AND type = $2 AND used_at IS NULL", [customerId, type, now]);
    const { token, hash } = this.tokens.generateOpaque();
    await manager.query(
      "INSERT INTO customer_tokens (id, customer_id, type, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [uuidv7(), customerId, type, hash, new Date(now.getTime() + ttlMs)],
    );
    return token;
  }

  private async sendPasswordReset(manager: EntityManager, customerId: string, email: string, firstName: string, now: Date): Promise<void> {
    const token = await this.issueToken(manager, customerId, "password_reset", RESET_TTL_MS, now);
    if (!token) return; // a link was issued less than 2 minutes ago
    await this.mail.enqueue({ to: email, template: "password_reset", data: { customerName: firstName, resetUrl: this.link("reset-password", token), expiresInMinutes: 60 } }, manager);
  }

  /** Runs the work after the HTTP response; failures are logged, never thrown at the caller. */
  private defer(label: string, work: () => Promise<void>): void {
    setImmediate(() => {
      work().catch((err: unknown) => this.logger.error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`));
    });
  }

  private link(page: "verify-email" | "reset-password", token: string): string {
    return `${this.env.STOREFRONT_URL.replace(/\/+$/, "")}/account/${page}?token=${encodeURIComponent(token)}`;
  }
}
