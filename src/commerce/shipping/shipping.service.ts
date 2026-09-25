import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { AppException } from "../../common/errors/app-exception";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { CartService } from "../cart/cart.service";
import { zoneCoversDepartment } from "../pricing";
import type {
  CreateRateInput,
  CreateZoneInput,
  ShippingRateDto,
  ShippingZoneDto,
  StorefrontShippingRateDto,
  UpdateRateInput,
  UpdateZoneInput,
} from "./shipping.dto";

interface ZoneRow {
  id: string;
  name: string;
  departments: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface RateRow {
  id: string;
  zone_id: string;
  name: string;
  price: string;
  free_over_subtotal: string | null;
  min_days: number | null;
  max_days: number | null;
  is_active: boolean;
  position: number;
  created_at: Date;
  updated_at: Date;
}

interface PublicRateRow {
  id: string;
  name: string;
  price: string;
  free_over_subtotal: string | null;
  min_days: number | null;
  max_days: number | null;
  departments: string[];
}

const RATE_COLUMNS = "id, zone_id, name, price, free_over_subtotal, min_days, max_days, is_active, position, created_at, updated_at";
const ZONE_COLUMNS = "id, name, departments, is_active, created_at, updated_at";

const isUniqueViolation = (e: unknown): boolean => (e as { driverError?: { code?: string } })?.driverError?.code === "23505";

const toRate = (r: RateRow): ShippingRateDto => ({
  id: r.id,
  zoneId: r.zone_id,
  name: r.name,
  price: Number(r.price),
  freeOverSubtotal: r.free_over_subtotal === null ? null : Number(r.free_over_subtotal),
  minDays: r.min_days,
  maxDays: r.max_days,
  isActive: r.is_active,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toZone = (z: ZoneRow, rates: RateRow[]): ShippingZoneDto => ({
  id: z.id,
  name: z.name,
  departments: z.departments,
  isActive: z.is_active,
  rates: rates.map(toRate),
  createdAt: z.created_at,
  updatedAt: z.updated_at,
});

@Injectable()
export class ShippingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
    private readonly carts: CartService,
  ) {}

  /* ── zones ── */

  async listZones(): Promise<ShippingZoneDto[]> {
    const zones = await this.dataSource.query<ZoneRow[]>(`SELECT ${ZONE_COLUMNS} FROM shipping_zones ORDER BY name ASC`);
    const rates = await this.dataSource.query<RateRow[]>(`SELECT ${RATE_COLUMNS} FROM shipping_rates ORDER BY position ASC, created_at ASC`);
    return zones.map((z) =>
      toZone(
        z,
        rates.filter((r) => r.zone_id === z.id),
      ),
    );
  }

  async getZone(id: string): Promise<ShippingZoneDto> {
    const zone = await this.findZone(this.dataSource.manager, id);
    const rates = await this.dataSource.query<RateRow[]>(
      `SELECT ${RATE_COLUMNS} FROM shipping_rates WHERE zone_id = $1 ORDER BY position ASC, created_at ASC`,
      [id],
    );
    return toZone(zone, rates);
  }

  async createZone(input: CreateZoneInput): Promise<ShippingZoneDto> {
    try {
      return await this.tx.run(async (manager) => {
        const rows = await manager.query<ZoneRow[]>(
          `INSERT INTO shipping_zones (id, name, departments, is_active) VALUES ($1, $2, $3::text[], $4) RETURNING ${ZONE_COLUMNS}`,
          [uuidv7(), input.name, input.departments, input.isActive],
        );
        const zone = rows[0];
        if (!zone) throw new Error("Zone insert returned no row");
        await this.audit.record(
          { action: "shipping_zone:create", entityType: "ShippingZone", entityId: zone.id, diff: { ...input } },
          manager,
        );
        return toZone(zone, []);
      });
    } catch (e) {
      throw this.translate(e);
    }
  }

  async updateZone(id: string, input: UpdateZoneInput): Promise<ShippingZoneDto> {
    try {
      return await this.tx.run(async (manager) => {
        const before = await this.lockZone(manager, id);
        const rows = await manager.query<ZoneRow[]>(
          `UPDATE shipping_zones SET name = $2, departments = $3::text[], is_active = $4, updated_at = now()
           WHERE id = $1 RETURNING ${ZONE_COLUMNS}`,
          [id, input.name ?? before.name, input.departments ?? before.departments, input.isActive ?? before.is_active],
        );
        const zone = rows[0];
        if (!zone) throw AppException.notFound("Shipping zone");
        await this.audit.record(
          {
            action: "shipping_zone:update",
            entityType: "ShippingZone",
            entityId: id,
            diff: {
              before: { name: before.name, departments: before.departments, isActive: before.is_active },
              after: { name: zone.name, departments: zone.departments, isActive: zone.is_active },
            },
          },
          manager,
        );
        const rates = await manager.query<RateRow[]>(
          `SELECT ${RATE_COLUMNS} FROM shipping_rates WHERE zone_id = $1 ORDER BY position ASC, created_at ASC`,
          [id],
        );
        return toZone(zone, rates);
      });
    } catch (e) {
      throw this.translate(e);
    }
  }

  async deleteZone(id: string): Promise<void> {
    await this.tx.run(async (manager) => {
      const zone = await this.lockZone(manager, id);
      await manager.query(`DELETE FROM shipping_zones WHERE id = $1`, [id]); // rates cascade
      await this.audit.record(
        { action: "shipping_zone:delete", entityType: "ShippingZone", entityId: id, diff: { name: zone.name, departments: zone.departments } },
        manager,
      );
    });
  }

  /* ── rates ── */

  async listRates(zoneId?: string): Promise<ShippingRateDto[]> {
    const rows = zoneId
      ? await this.dataSource.query<RateRow[]>(
          `SELECT ${RATE_COLUMNS} FROM shipping_rates WHERE zone_id = $1 ORDER BY position ASC, created_at ASC`,
          [zoneId],
        )
      : await this.dataSource.query<RateRow[]>(`SELECT ${RATE_COLUMNS} FROM shipping_rates ORDER BY zone_id, position ASC, created_at ASC`);
    return rows.map(toRate);
  }

  async getRate(id: string): Promise<ShippingRateDto> {
    const rows = await this.dataSource.query<RateRow[]>(`SELECT ${RATE_COLUMNS} FROM shipping_rates WHERE id = $1`, [id]);
    if (!rows[0]) throw AppException.notFound("Shipping rate");
    return toRate(rows[0]);
  }

  async createRate(input: CreateRateInput): Promise<ShippingRateDto> {
    return this.tx.run(async (manager) => {
      await this.lockZone(manager, input.zoneId);
      const rows = await manager.query<RateRow[]>(
        `INSERT INTO shipping_rates (id, zone_id, name, price, free_over_subtotal, min_days, max_days, is_active, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${RATE_COLUMNS}`,
        [uuidv7(), input.zoneId, input.name, input.price, input.freeOverSubtotal, input.minDays, input.maxDays, input.isActive, input.position],
      );
      const rate = rows[0];
      if (!rate) throw new Error("Rate insert returned no row");
      await this.audit.record({ action: "shipping_rate:create", entityType: "ShippingRate", entityId: rate.id, diff: { ...input } }, manager);
      return toRate(rate);
    });
  }

  async updateRate(id: string, input: UpdateRateInput): Promise<ShippingRateDto> {
    return this.tx.run(async (manager) => {
      const current = await manager.query<RateRow[]>(`SELECT ${RATE_COLUMNS} FROM shipping_rates WHERE id = $1 FOR UPDATE`, [id]);
      const before = current[0];
      if (!before) throw AppException.notFound("Shipping rate");
      const next = {
        name: input.name ?? before.name,
        price: input.price ?? Number(before.price),
        freeOverSubtotal: input.freeOverSubtotal !== undefined ? input.freeOverSubtotal : before.free_over_subtotal === null ? null : Number(before.free_over_subtotal),
        minDays: input.minDays !== undefined ? input.minDays : before.min_days,
        maxDays: input.maxDays !== undefined ? input.maxDays : before.max_days,
        isActive: input.isActive ?? before.is_active,
        position: input.position ?? before.position,
      };
      if (next.minDays !== null && next.maxDays !== null && next.minDays > next.maxDays) {
        throw AppException.badRequest("VALIDATION_ERROR", "minDays cannot exceed maxDays");
      }
      const rows = await manager.query<RateRow[]>(
        `UPDATE shipping_rates SET name = $2, price = $3, free_over_subtotal = $4, min_days = $5, max_days = $6,
                is_active = $7, position = $8, updated_at = now()
         WHERE id = $1 RETURNING ${RATE_COLUMNS}`,
        [id, next.name, next.price, next.freeOverSubtotal, next.minDays, next.maxDays, next.isActive, next.position],
      );
      const rate = rows[0];
      if (!rate) throw AppException.notFound("Shipping rate");
      await this.audit.record(
        { action: "shipping_rate:update", entityType: "ShippingRate", entityId: id, diff: { before: toRate(before), after: toRate(rate) } },
        manager,
      );
      return toRate(rate);
    });
  }

  async deleteRate(id: string): Promise<void> {
    await this.tx.run(async (manager) => {
      const rows = await manager.query<RateRow[]>(`DELETE FROM shipping_rates WHERE id = $1 RETURNING ${RATE_COLUMNS}`, [id]);
      const rate = rows[0];
      if (!rate) throw AppException.notFound("Shipping rate");
      await this.audit.record({ action: "shipping_rate:delete", entityType: "ShippingRate", entityId: id, diff: { ...toRate(rate) } }, manager);
    });
  }

  /* ── storefront ── */

  async ratesForCart(cartId: string, token: string, department: string): Promise<StorefrontShippingRateDto[]> {
    const quote = await this.carts.quoteFor(cartId, token);
    const rows = await this.dataSource.query<PublicRateRow[]>(
      `SELECT r.id, r.name, r.price, r.free_over_subtotal, r.min_days, r.max_days, z.departments
       FROM shipping_rates r JOIN shipping_zones z ON z.id = r.zone_id
       WHERE r.is_active = true AND z.is_active = true
       ORDER BY r.position ASC, r.created_at ASC`,
    );
    const discounted = quote.subtotal - quote.discountTotal;
    const freeByDiscount = quote.discount?.type === "free_shipping";
    return rows
      .filter((r) => zoneCoversDepartment(r.departments, department))
      .map((r) => {
        const basePrice = Number(r.price);
        const freeOver = r.free_over_subtotal === null ? null : Number(r.free_over_subtotal);
        const isFree = freeByDiscount || (freeOver !== null && discounted >= freeOver);
        return {
          id: r.id,
          name: r.name,
          price: isFree ? 0 : basePrice,
          basePrice,
          isFree,
          minDays: r.min_days,
          maxDays: r.max_days,
        };
      });
  }

  /* ── helpers ── */

  private async findZone(manager: EntityManager, id: string): Promise<ZoneRow> {
    const rows = await manager.query<ZoneRow[]>(`SELECT ${ZONE_COLUMNS} FROM shipping_zones WHERE id = $1`, [id]);
    if (!rows[0]) throw AppException.notFound("Shipping zone");
    return rows[0];
  }

  private async lockZone(manager: EntityManager, id: string): Promise<ZoneRow> {
    const rows = await manager.query<ZoneRow[]>(`SELECT ${ZONE_COLUMNS} FROM shipping_zones WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw AppException.notFound("Shipping zone");
    return rows[0];
  }

  private translate(e: unknown): unknown {
    return isUniqueViolation(e) ? AppException.conflict("ZONE_EXISTS", "A shipping zone with this name already exists") : e;
  }
}
