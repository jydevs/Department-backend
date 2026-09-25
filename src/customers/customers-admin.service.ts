import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, SelectQueryBuilder } from "typeorm";
import { Clock } from "../common/clock/clock";
import { csvCell, csvRow } from "../common/csv";
import { AppException } from "../common/errors/app-exception";
import { OffsetPage, toOffsetPage } from "../common/pagination/pagination";
import { escapeLike } from "../common/sql/escape-like";
import { AuditService } from "../audit/audit.service";
import { Order } from "../commerce/entities/order.entity";
import { TransactionService } from "../database/transaction.service";
import type {
  AdminCustomerDetailDto,
  AdminCustomerDto,
  AdminUpdateCustomerInput,
  CustomerExportQuery,
  CustomerListQuery,
} from "./dto/customers.dto";
import { Customer, CustomerAddress } from "./entities";
import { CustomerErasureService } from "./customer-erasure.service";
import { toAddressDto, toAdminCustomer } from "./customers-support";

export const EXPORT_MAX_ROWS = 50_000;
const EXPORT_BATCH = 1000;
const DETAIL_MAX_ORDERS = 100;
const CSV_HEADER = ["id", "email", "firstName", "lastName", "phone", "acceptsMarketing", "marketingConsentAt", "emailVerifiedAt", "isActive", "tags", "createdAt", "lastLoginAt"];

@Injectable()
export class CustomersAdminService {
  constructor(
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(CustomerAddress) private readonly addresses: Repository<CustomerAddress>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly transactions: TransactionService,
    private readonly erasure: CustomerErasureService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(query: CustomerListQuery): Promise<OffsetPage<AdminCustomerDto>> {
    const qb = this.filtered(query)
      .orderBy("c.createdAt", "DESC")
      .addOrderBy("c.id", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize);
    const [rows, total] = await qb.getManyAndCount();
    return toOffsetPage(rows.map(toAdminCustomer), total, query.page, query.pageSize);
  }

  async detail(id: string): Promise<AdminCustomerDetailDto> {
    const customer = await this.customers.findOne({ where: { id } });
    if (!customer) throw AppException.notFound("Customer");
    const [addresses, orders] = await Promise.all([
      this.addresses.find({ where: { customerId: id }, order: { isDefault: "DESC", createdAt: "ASC" } }),
      this.orders.find({ where: { customerId: id }, order: { createdAt: "DESC", id: "DESC" }, take: DETAIL_MAX_ORDERS }),
    ]);
    return {
      ...toAdminCustomer(customer),
      internalNote: customer.internalNote ?? null,
      addresses: addresses.map(toAddressDto),
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        currency: o.currency,
        total: o.total,
        createdAt: o.createdAt,
      })),
    };
  }

  async update(id: string, input: AdminUpdateCustomerInput): Promise<AdminCustomerDto> {
    return this.transactions.run(async (manager) => {
      const repo = manager.getRepository(Customer);
      const customer = await repo.findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
      if (!customer) throw AppException.notFound("Customer");
      if (customer.anonymizedAt) throw AppException.conflict("ALREADY_ANONYMIZED", "Anonymized customers cannot be edited");

      const patch: Partial<Customer> = {};
      const changed: Record<string, unknown> = {};
      if (input.firstName !== undefined && input.firstName !== customer.firstName) {
        patch.firstName = input.firstName;
        changed.firstName = true;
      }
      if (input.lastName !== undefined && input.lastName !== customer.lastName) {
        patch.lastName = input.lastName;
        changed.lastName = true;
      }
      if (input.phone !== undefined && input.phone !== (customer.phone ?? null)) {
        patch.phone = input.phone;
        changed.phone = true;
      }
      if (input.internalNote !== undefined && input.internalNote !== (customer.internalNote ?? null)) {
        patch.internalNote = input.internalNote;
        changed.internalNote = true;
      }
      if (input.tags !== undefined) {
        const tags = [...new Set(input.tags)];
        if (tags.join("\u0000") !== customer.tags.join("\u0000")) {
          patch.tags = tags;
          changed.tags = { old: customer.tags, new: tags };
        }
      }
      if (input.isActive !== undefined && input.isActive !== customer.isActive) {
        patch.isActive = input.isActive;
        changed.isActive = { old: customer.isActive, new: input.isActive };
        if (!input.isActive) {
          await manager.query("UPDATE customer_refresh_tokens SET revoked_at = $2 WHERE customer_id = $1 AND revoked_at IS NULL", [id, this.clock.now()]);
        }
      }

      if (Object.keys(patch).length > 0) {
        await repo.update({ id }, { ...patch, version: () => "version + 1" });
        await this.audit.record({ action: "customer:update", entityType: "Customer", entityId: id, diff: changed }, manager);
      }
      const fresh = await repo.findOneOrFail({ where: { id } });
      return toAdminCustomer(fresh);
    });
  }

  /** Right to erasure on behalf of the customer. The controller restricts it to owner/admin. */
  async erase(id: string): Promise<void> {
    await this.transactions.run(async (manager) => {
      const rows: { id: string }[] = await manager.query("SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
      if (rows.length === 0) throw AppException.notFound("Customer");
      await this.erasure.eraseOrFail(manager, id, "customer:erase");
    });
  }

  /**
   * CSV in batches of 1000 by keyset on the uuid v7 id, capped at 50 000 rows: memory stays flat.
   * Anonymized customers are not exported.
   */
  async *exportCsv(query: CustomerExportQuery): AsyncGenerator<string> {
    await this.audit.record({ action: "customer:export", entityType: "Customer" });
    yield csvRow(CSV_HEADER);

    let lastId: string | null = null;
    let sent = 0;
    while (sent < EXPORT_MAX_ROWS) {
      const qb: SelectQueryBuilder<Customer> = this.filtered(query).andWhere("c.anonymizedAt IS NULL").orderBy("c.id", "ASC").limit(Math.min(EXPORT_BATCH, EXPORT_MAX_ROWS - sent));
      if (lastId) qb.andWhere("c.id > :lastId", { lastId });
      const rows = await qb.getMany();
      if (rows.length === 0) return;

      yield rows
        .map((c) => {
          // marketing consent only counts once the mailbox is verified
          const consents = c.acceptsMarketing && !!c.emailVerifiedAt;
          return [c.id, c.email, c.firstName, c.lastName, c.phone, consents, consents ? c.marketingConsentAt : null, c.emailVerifiedAt, c.isActive, c.tags.join("|"), c.createdAt, c.lastLoginAt]
            .map(csvCell)
            .join(",");
        })
        .join("\r\n") + "\r\n";

      sent += rows.length;
      lastId = rows[rows.length - 1]!.id;
      if (rows.length < EXPORT_BATCH) return;
    }
  }

  /** Shared filters for list and export. `q` is escaped so `%` and `_` match literally. */
  private filtered(query: Pick<CustomerListQuery, "q" | "acceptsMarketing" | "isActive" | "tag">): SelectQueryBuilder<Customer> {
    const qb = this.customers.createQueryBuilder("c");
    if (query.q) {
      qb.andWhere("(c.email ILIKE :q ESCAPE '\\' OR (c.firstName || ' ' || c.lastName) ILIKE :q ESCAPE '\\')", { q: `%${escapeLike(query.q)}%` });
    }
    if (query.acceptsMarketing !== undefined) {
      // consent only counts when the e-mail is verified
      qb.andWhere(query.acceptsMarketing ? "(c.acceptsMarketing = true AND c.emailVerifiedAt IS NOT NULL)" : "NOT (c.acceptsMarketing = true AND c.emailVerifiedAt IS NOT NULL)");
    }
    if (query.isActive !== undefined) qb.andWhere("c.isActive = :ia", { ia: query.isActive });
    if (query.tag) qb.andWhere(":tag = ANY(c.tags)", { tag: query.tag });
    return qb;
  }
}
