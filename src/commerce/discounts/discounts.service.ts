import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { AppException } from "../../common/errors/app-exception";
import { Clock } from "../../common/clock/clock";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { OffsetPage, toOffsetPage } from "../../common/pagination/pagination";
import { SqlParams } from "../../common/sql/sql-params";
import { escapeLike } from "../../common/sql/escape-like";
import { firstRow } from "../../common/sql/query-result";
import type {
  CreateDiscountInput,
  DiscountDto,
  DiscountRedemptionDto,
  ListDiscountsQuery,
  UpdateDiscountInput,
} from "./discounts.dto";

interface DiscountRow {
  id: string;
  code: string;
  title: string;
  type: DiscountDto["type"];
  value: number;
  min_subtotal: string | null;
  starts_at: Date;
  ends_at: Date | null;
  usage_limit: number | null;
  used_count: number;
  once_per_email: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface RedemptionRow {
  id: string;
  order_id: string;
  order_number: number | null;
  email: string;
  amount: string;
  created_at: Date;
}

const COLUMNS =
  "id, code, title, type, value, min_subtotal, starts_at, ends_at, usage_limit, used_count, once_per_email, is_active, created_at, updated_at";

const isUniqueViolation = (e: unknown): boolean => (e as { driverError?: { code?: string } })?.driverError?.code === "23505";

const toDto = (r: DiscountRow): DiscountDto => ({
  id: r.id,
  code: r.code,
  title: r.title,
  type: r.type,
  value: r.value,
  minSubtotal: r.min_subtotal === null ? null : Number(r.min_subtotal),
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  usageLimit: r.usage_limit,
  usedCount: r.used_count,
  oncePerEmail: r.once_per_email,
  isActive: r.is_active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

@Injectable()
export class DiscountsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(query: ListDiscountsQuery): Promise<OffsetPage<DiscountDto>> {
    const params = new SqlParams();
    const where: string[] = [];
    if (query.q) {
      const p = params.push(`%${escapeLike(query.q)}%`);
      where.push(`(code ILIKE ${p} ESCAPE '\\' OR title ILIKE ${p} ESCAPE '\\')`);
    }
    if (query.isActive !== undefined) where.push(`is_active = ${params.push(query.isActive)}`);
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const totalRows = await this.dataSource.query<{ n: number }[]>(`SELECT count(*)::int AS n FROM discounts ${clause}`, params.values);
    const limit = params.push(query.pageSize);
    const offset = params.push((query.page - 1) * query.pageSize);
    const rows = await this.dataSource.query<DiscountRow[]>(
      `SELECT ${COLUMNS} FROM discounts ${clause} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      params.values,
    );
    return toOffsetPage(rows.map(toDto), totalRows[0]?.n ?? 0, query.page, query.pageSize);
  }

  async get(id: string): Promise<DiscountDto> {
    const rows = await this.dataSource.query<DiscountRow[]>(`SELECT ${COLUMNS} FROM discounts WHERE id = $1`, [id]);
    if (!rows[0]) throw AppException.notFound("Discount");
    return toDto(rows[0]);
  }

  async create(input: CreateDiscountInput): Promise<DiscountDto> {
    const startsAt = input.startsAt ?? this.clock.now();
    if (input.endsAt && input.endsAt <= startsAt) {
      throw AppException.badRequest("VALIDATION_ERROR", "endsAt must be after startsAt");
    }
    try {
      return await this.tx.run(async (manager) => {
        const rows = await manager.query<DiscountRow[]>(
          `INSERT INTO discounts (id, code, title, type, value, min_subtotal, starts_at, ends_at, usage_limit, once_per_email, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLUMNS}`,
          [
            uuidv7(),
            input.code,
            input.title,
            input.type,
            input.value,
            input.minSubtotal,
            startsAt,
            input.endsAt,
            input.usageLimit,
            input.oncePerEmail,
            input.isActive,
          ],
        );
        const row = rows[0];
        if (!row) throw new Error("Discount insert returned no row");
        await this.audit.record(
          { action: "discount:create", entityType: "Discount", entityId: row.id, diff: { ...input, startsAt } },
          manager,
        );
        return toDto(row);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw AppException.conflict("DISCOUNT_CODE_EXISTS", "A discount with this code already exists");
      throw e;
    }
  }

  async update(id: string, input: UpdateDiscountInput): Promise<DiscountDto> {
    return this.tx.run(async (manager) => {
      const current = await manager.query<DiscountRow[]>(`SELECT ${COLUMNS} FROM discounts WHERE id = $1 FOR UPDATE`, [id]);
      const before = current[0];
      if (!before) throw AppException.notFound("Discount");

      const next = {
        title: input.title ?? before.title,
        value: input.value ?? before.value,
        minSubtotal: input.minSubtotal !== undefined ? input.minSubtotal : before.min_subtotal === null ? null : Number(before.min_subtotal),
        startsAt: input.startsAt ?? before.starts_at,
        endsAt: input.endsAt !== undefined ? input.endsAt : before.ends_at,
        usageLimit: input.usageLimit !== undefined ? input.usageLimit : before.usage_limit,
        oncePerEmail: input.oncePerEmail ?? before.once_per_email,
        isActive: input.isActive ?? before.is_active,
      };
      if (before.type === "percent" && (next.value < 1 || next.value > 100)) {
        throw AppException.badRequest("VALIDATION_ERROR", "Percent value must be between 1 and 100");
      }
      if (before.type === "fixed" && (next.value < 1 || next.value > 2_000_000_000)) {
        throw AppException.badRequest("VALIDATION_ERROR", "Fixed value must be between 1 and 2000000000");
      }
      if (before.type === "free_shipping" && next.value !== 0) {
        throw AppException.badRequest("VALIDATION_ERROR", "free_shipping discounts have no value");
      }
      if (next.endsAt && new Date(next.endsAt) <= new Date(next.startsAt)) {
        throw AppException.badRequest("VALIDATION_ERROR", "endsAt must be after startsAt");
      }

      const rows = await manager.query<DiscountRow[]>(
        `UPDATE discounts SET title = $2, value = $3, min_subtotal = $4, starts_at = $5, ends_at = $6,
                usage_limit = $7, once_per_email = $8, is_active = $9, updated_at = now()
         WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, next.title, next.value, next.minSubtotal, next.startsAt, next.endsAt, next.usageLimit, next.oncePerEmail, next.isActive],
      );
      const row = firstRow<DiscountRow>(rows);
      if (!row) throw AppException.notFound("Discount");
      await this.audit.record(
        { action: "discount:update", entityType: "Discount", entityId: id, diff: { before: toDto(before), after: toDto(row) } },
        manager,
      );
      return toDto(row);
    });
  }

  async remove(id: string): Promise<void> {
    await this.tx.run(async (manager) => {
      const rows = await manager.query<DiscountRow[]>(`SELECT ${COLUMNS} FROM discounts WHERE id = $1 FOR UPDATE`, [id]);
      const discount = rows[0];
      if (!discount) throw AppException.notFound("Discount");
      if (discount.used_count > 0) {
        throw AppException.conflict("DISCOUNT_IN_USE", "This discount has redemptions; deactivate it instead of deleting it");
      }
      await manager.query(`DELETE FROM discounts WHERE id = $1`, [id]);
      await this.audit.record({ action: "discount:delete", entityType: "Discount", entityId: id, diff: { ...toDto(discount) } }, manager);
    });
  }

  async redemptions(id: string, page: number, pageSize: number): Promise<OffsetPage<DiscountRedemptionDto>> {
    const exists = await this.dataSource.query<{ id: string }[]>(`SELECT id FROM discounts WHERE id = $1`, [id]);
    if (!exists[0]) throw AppException.notFound("Discount");
    const totalRows = await this.dataSource.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM discount_redemptions WHERE discount_id = $1`,
      [id],
    );
    const rows = await this.dataSource.query<RedemptionRow[]>(
      `SELECT dr.id, dr.order_id, o.order_number, dr.email, dr.amount, dr.created_at
       FROM discount_redemptions dr LEFT JOIN orders o ON o.id = dr.order_id
       WHERE dr.discount_id = $1 ORDER BY dr.created_at DESC, dr.id DESC LIMIT $2 OFFSET $3`,
      [id, pageSize, (page - 1) * pageSize],
    );
    const items: DiscountRedemptionDto[] = rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderNumber: r.order_number,
      email: r.email,
      amount: Number(r.amount),
      createdAt: r.created_at,
    }));
    return toOffsetPage(items, totalRows[0]?.n ?? 0, page, pageSize);
  }
}
