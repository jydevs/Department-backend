import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Not, Repository } from "typeorm";
import { Clock } from "../common/clock/clock";
import { AppException } from "../common/errors/app-exception";
import { RequestContextStore } from "../common/context/request-context";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "../common/auth/login-attempts";
import { OffsetPage, toOffsetPage } from "../common/pagination/pagination";
import { AuditService } from "../audit/audit.service";
import { Order } from "../commerce/entities/order.entity";
import { Payment } from "../commerce/entities/payment.entity";
import { PAYMENT_PROVIDER, PaymentProvider, type PaymentInstructions } from "../commerce/payments/payment-provider";
import { TransactionService } from "../database/transaction.service";
import { PasswordService } from "../identity/auth/password.service";
import type {
  CreateAddressInput,
  CustomerAddressDto,
  CustomerDataExportDto,
  CustomerProfileDto,
  PublicOrderDetailDto,
  PublicOrderSummaryDto,
  UpdateAddressInput,
  UpdateProfileInput,
} from "./dto/customers.dto";
import { Customer, CustomerAddress, CustomerRefreshToken } from "./entities";
import { CustomerErasureService } from "./customer-erasure.service";
import { MAX_ADDRESSES, queryRows, toAddressDto, toOrderSummary, toProfile, toPublicOrder } from "./customers-support";

const EXPORT_MAX_ORDERS = 1000;

/** Everything a logged-in customer can do with their own account. Every query is scoped by the caller's id. */
@Injectable()
export class CustomersAccountService {
  constructor(
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(CustomerAddress) private readonly addresses: Repository<CustomerAddress>,
    @InjectRepository(CustomerRefreshToken) private readonly sessions: Repository<CustomerRefreshToken>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly transactions: TransactionService,
    private readonly passwords: PasswordService,
    private readonly erasure: CustomerErasureService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /* ── profile ──────────────────────────────────────────── */

  async getProfile(customerId: string): Promise<CustomerProfileDto> {
    return toProfile(await this.requireCustomer(customerId));
  }

  async updateProfile(customerId: string, input: UpdateProfileInput): Promise<CustomerProfileDto> {
    const customer = await this.requireCustomer(customerId);
    const patch: Partial<Customer> = {};
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.acceptsMarketing !== undefined && input.acceptsMarketing !== customer.acceptsMarketing) {
      patch.acceptsMarketing = input.acceptsMarketing;
      patch.marketingConsentAt = input.acceptsMarketing ? this.clock.now() : null; // consent is timestamped, withdrawal clears it
    }
    if (Object.keys(patch).length > 0) {
      await this.transactions.run(async (manager) => {
        await manager.getRepository(Customer).update({ id: customerId }, { ...patch, version: () => "version + 1" });
        await this.audit.record({ action: "CUSTOMER_PROFILE_UPDATED", entityType: "Customer", entityId: customerId, diff: { fields: Object.keys(patch) } }, manager);
      });
    }
    return toProfile(await this.requireCustomer(customerId));
  }

  /** Verifies the current password, then signs out every session (including this one). */
  async changePassword(customerId: string, currentPassword: string, newPassword: string): Promise<void> {
    await this.confirmPassword(customerId, currentPassword, "The current password is incorrect");
    const newHash = await this.passwords.hash(newPassword);
    const now = this.clock.now();

    await this.transactions.run(async (manager) => {
      await manager.query("UPDATE customers SET password_hash = $2, failed_login_count = 0, locked_until = NULL, version = version + 1 WHERE id = $1", [customerId, newHash]);
      await clearLoginFailures(manager, "customer", customerId);
      await manager.query("UPDATE customer_refresh_tokens SET revoked_at = $2 WHERE customer_id = $1 AND revoked_at IS NULL", [customerId, now]);
      await this.audit.record({ action: "CUSTOMER_PASSWORD_CHANGED", entityType: "Customer", entityId: customerId }, manager);
    });
  }

  /* ── addresses ────────────────────────────────────────── */

  async listAddresses(customerId: string): Promise<CustomerAddressDto[]> {
    const rows = await this.addresses.find({ where: { customerId }, order: { isDefault: "DESC", createdAt: "ASC" } });
    return rows.map(toAddressDto);
  }

  async createAddress(customerId: string, input: CreateAddressInput): Promise<CustomerAddressDto> {
    return this.transactions.run(async (manager) => {
      // serialise per customer so two parallel requests cannot exceed the cap or leave two defaults
      await manager.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [customerId]);
      const repo = manager.getRepository(CustomerAddress);

      const count = await repo.count({ where: { customerId } });
      if (count >= MAX_ADDRESSES) throw AppException.conflict("ADDRESS_LIMIT", `You can save up to ${MAX_ADDRESSES} addresses`);

      const makeDefault = input.isDefault === true || count === 0;
      if (makeDefault) await repo.update({ customerId }, { isDefault: false });

      const address = repo.create({
        customerId,
        label: input.label ?? null,
        isDefault: makeDefault,
        fullName: input.fullName,
        phone: input.phone,
        department: input.department,
        city: input.city,
        address1: input.address1,
        address2: input.address2 ?? null,
        postalCode: input.postalCode ?? null,
        documentType: input.documentType ?? null,
        documentNumber: input.documentNumber ?? null,
      });
      return toAddressDto(await repo.save(address));
    });
  }

  async updateAddress(customerId: string, addressId: string, input: UpdateAddressInput): Promise<CustomerAddressDto> {
    return this.transactions.run(async (manager) => {
      await manager.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [customerId]);
      const repo = manager.getRepository(CustomerAddress);
      const address = await repo.findOne({ where: { id: addressId, customerId } });
      if (!address) throw AppException.notFound("Address");

      if (input.label !== undefined) address.label = input.label;
      if (input.fullName !== undefined) address.fullName = input.fullName;
      if (input.phone !== undefined) address.phone = input.phone;
      if (input.department !== undefined) address.department = input.department;
      if (input.city !== undefined) address.city = input.city;
      if (input.address1 !== undefined) address.address1 = input.address1;
      if (input.address2 !== undefined) address.address2 = input.address2;
      if (input.postalCode !== undefined) address.postalCode = input.postalCode;
      if (input.documentType !== undefined) address.documentType = input.documentType;
      if (input.documentNumber !== undefined) address.documentNumber = input.documentNumber;
      // removing the document type removes its number too, unless a new number is sent in the same request
      if (input.documentType === null && input.documentNumber === undefined) address.documentNumber = null;

      // the default can only be moved to another address, never simply switched off
      if (input.isDefault === true && !address.isDefault) {
        await repo.update({ customerId, id: Not(addressId) }, { isDefault: false });
        address.isDefault = true;
      }
      return toAddressDto(await repo.save(address));
    });
  }

  async deleteAddress(customerId: string, addressId: string): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [customerId]);
      const repo = manager.getRepository(CustomerAddress);
      const address = await repo.findOne({ where: { id: addressId, customerId } });
      if (!address) throw AppException.notFound("Address");

      await repo.delete({ id: addressId, customerId });
      if (address.isDefault) {
        const next = await repo.findOne({ where: { customerId }, order: { createdAt: "DESC" } });
        if (next) await repo.update({ id: next.id }, { isDefault: true });
      }
    });
  }

  /* ── orders ───────────────────────────────────────────── */

  async listOrders(customerId: string, page: number, pageSize: number): Promise<OffsetPage<PublicOrderSummaryDto>> {
    const [rows, total] = await this.orders.findAndCount({
      where: { customerId, status: Not("expired") },
      order: { createdAt: "DESC", id: "DESC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const counts = new Map<string, number>();
    if (rows.length > 0) {
      const sums = await queryRows<{ order_id: string; items: number }>(
        this.orders.manager,
        "SELECT order_id, SUM(quantity)::int AS items FROM order_lines WHERE order_id = ANY($1::uuid[]) GROUP BY order_id",
        [rows.map((o) => o.id)],
      );
      for (const s of sums) counts.set(s.order_id, s.items);
    }
    return toOffsetPage(
      rows.map((o) => toOrderSummary(o, counts.get(o.id) ?? 0)),
      total,
      page,
      pageSize,
    );
  }

  /** Only the caller's own order; any other number answers 404 exactly like a missing one. */
  async getOrder(customerId: string, orderNumber: number): Promise<PublicOrderDetailDto> {
    const order = await this.orders.findOne({ where: { customerId, orderNumber, status: Not("expired") }, relations: { lines: true, fulfillments: true } });
    if (!order) throw AppException.notFound("Order");
    const lines = order.lines ?? [];
    const manager = this.orders.manager;
    const handles = new Map<string, string>();
    const productIds = [...new Set(lines.map((l) => l.productId))];
    if (productIds.length > 0) {
      const rows = await manager.query<{ id: string; handle: string }[]>("SELECT id, handle FROM products WHERE id = ANY($1::uuid[])", [productIds]);
      for (const r of rows) handles.set(r.id, r.handle);
    }
    const payment = await manager.getRepository(Payment).findOne({ where: { orderId: order.id }, order: { createdAt: "DESC" } });
    // same rule as the public order status: instructions only while pending and for the active provider
    let instructions: PaymentInstructions | null = null;
    if (order.status === "pending" && order.paymentProvider === this.provider.name) {
      try {
        instructions = this.provider.createPayment(order);
      } catch {
        instructions = null;
      }
    }
    const base = toPublicOrder(order, lines, order.fulfillments ?? []);
    return {
      ...base,
      lines: base.lines.map((l, i) => ({
        ...l,
        variantId: lines[i].variantId,
        productId: lines[i].productId,
        productHandle: handles.get(lines[i].productId) ?? null,
      })),
      payment: payment ? { provider: payment.provider, status: payment.status, method: payment.method ?? null, instructions } : null,
      reservedUntil: order.status === "pending" ? (order.reservedUntil ?? null) : null,
    };
  }

  /* ── Habeas Data: export and erase ────────────────────── */

  async exportData(customerId: string): Promise<CustomerDataExportDto> {
    const customer = await this.requireCustomer(customerId);
    const [addresses, orders, sessions, newsletter, contacts] = await Promise.all([
      this.listAddresses(customerId),
      this.orders.find({
        where: { customerId },
        relations: { lines: true, fulfillments: true },
        order: { createdAt: "DESC" },
        take: EXPORT_MAX_ORDERS,
      }),
      this.sessions.find({ where: { customerId }, order: { createdAt: "DESC" }, take: 100 }),
      queryRows<{ status: string; source: string; consent_at: Date | null; created_at: Date }>(
        this.customers.manager,
        "SELECT status, source, consent_at, created_at FROM newsletter_subscribers WHERE email = $1",
        [customer.email],
      ),
      queryRows<{ name: string; subject: string | null; message: string; status: string; created_at: Date }>(
        this.customers.manager,
        "SELECT name, subject, message, status, created_at FROM contact_messages WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 200",
        [customer.email],
      ),
    ]);

    await this.audit.record({ action: "CUSTOMER_DATA_EXPORT", entityType: "Customer", entityId: customerId });
    return {
      exportedAt: this.clock.now(),
      profile: { ...toProfile(customer), marketingConsentAt: customer.marketingConsentAt ?? null, lastLoginAt: customer.lastLoginAt ?? null },
      addresses,
      orders: orders.map((o) => toPublicOrder(o, o.lines ?? [], o.fulfillments ?? [])),
      sessions: sessions.map((s) => ({
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt ?? null,
        userAgent: s.userAgent ?? null,
        ip: s.ip ?? null,
      })),
      newsletter: newsletter[0]
        ? { status: newsletter[0].status, source: newsletter[0].source, consentAt: newsletter[0].consent_at, createdAt: newsletter[0].created_at }
        : null,
      contactMessages: contacts.map((m) => ({ name: m.name, subject: m.subject, message: m.message, status: m.status, createdAt: m.created_at })),
    };
  }

  /** Anonymizes the account after confirming the password. */
  async deleteAccount(customerId: string, password: string): Promise<void> {
    await this.confirmPassword(customerId, password, "The password is incorrect");
    await this.transactions.run((manager) => this.erasure.erase(manager, customerId, "CUSTOMER_SELF_ERASED"));
  }

  /* ── internals ────────────────────────────────────────── */

  /**
   * Password re-confirmation for sensitive actions. Failures feed the same atomic lockout counter as the login
   * (5 misses / 15 min); a locked account cannot be used to guess the password through these endpoints either.
   */
  private async confirmPassword(customerId: string, password: string, message: string): Promise<void> {
    const customer = await this.requireCustomer(customerId);
    const now = this.clock.now();
    const ip = RequestContextStore.get()?.ip;
    const locked = await isLoginBlocked(this.customers.manager, "customer", customerId, ip, now);
    const ok = !!customer.passwordHash && (await this.passwords.verify(password, customer.passwordHash));
    if (locked || !ok) {
      if (!locked) await recordLoginFailure(this.customers.manager, "customer", customerId, ip, now);
      throw AppException.badRequest("INVALID_PASSWORD", message);
    }
  }

  private async requireCustomer(customerId: string): Promise<Customer> {
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer || !customer.isActive || customer.anonymizedAt) throw AppException.unauthorized();
    return customer;
  }
}

