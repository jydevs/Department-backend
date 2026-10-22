import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, EntityManager, In, Not, QueryFailedError } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { Location, InventoryLevel, InventoryAdjustment } from "./entities";
import { Variant } from "../catalog/entities/variant.entity";
import { Product } from "../catalog/entities/product.entity";
import { AppException } from "../common/errors/app-exception";
import { TransactionService } from "../database/transaction.service";
import { AuditService } from "../audit/audit.service";
import { Clock } from "../common/clock/clock";
import { CatalogRevalidationService } from "../catalog/revalidation/catalog-revalidation.service";
import { AdjustInventoryInput, InventoryQueryParams } from "./dto/inventory-level.dto";
import { CreateLocationInput, UpdateLocationInput } from "./dto/location.dto";
import { OffsetPage, toOffsetPage, CursorPage, toCursorPage, decodeCursor } from "../common/pagination/pagination";
import { InventoryLevelDto, InventoryAdjustmentDto } from "./dto/inventory-level.dto";
import { LocationDto } from "./dto/location.dto";
import { z } from "zod";
import { escapeLike } from "../common/sql/escape-like";
import { affectedCount } from "../common/sql/query-result";

/** Number reported by `availableFor` for variants that never run out (untracked or backorderable). */
export const UNLIMITED_AVAILABILITY = 1_000_000_000;
const MAX_ON_HAND = 1_000_000_000;
const LOW_STOCK_DEFAULT = 5;

interface AdjustmentRow {
  id: string;
  variant_id: string;
  location_id: string;
  delta: number;
  reason: string;
  note: string | null;
  actor_id: string | null;
  created_at: Date;
  variant_title: string | null;
  product_id: string | null;
  product_title: string | null;
  product_handle: string | null;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Location)
    private readonly locationRepository: Repository<Location>,
    @InjectRepository(InventoryLevel)
    private readonly inventoryLevelRepository: Repository<InventoryLevel>,
    @InjectRepository(InventoryAdjustment)
    private readonly adjustmentRepository: Repository<InventoryAdjustment>,
    @InjectRepository(Variant)
    private readonly variantRepository: Repository<Variant>,
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
    private readonly clock: Clock,
    private readonly catalogRevalidation: CatalogRevalidationService,
  ) {}

  /* ── Locations ─────────────────────────────────────────────── */

  async createLocation(input: CreateLocationInput): Promise<LocationDto> {
    try {
      return await this.transactionService.run(async (manager) => {
        const locationRepo = manager.getRepository(Location);
        const existingDefault = await locationRepo.findOne({ where: { isDefault: true } });

        const location = new Location();
        location.name = input.name;
        location.isDefault = !existingDefault;
        location.isActive = true;

        const saved = await locationRepo.save(location);

        await this.auditService.record(
          {
            action: "location:create",
            entityType: "Location",
            entityId: saved.id,
            diff: { name: saved.name, isDefault: saved.isDefault },
          },
          manager,
        );

        return this.mapLocationToDto(saved);
      });
    } catch (e) {
      throw this.translateDefaultRace(e);
    }
  }

  async listLocations(): Promise<LocationDto[]> {
    const locations = await this.locationRepository.find({ order: { isDefault: "DESC", createdAt: "ASC" } });
    return locations.map((l) => this.mapLocationToDto(l));
  }

  async getLocationById(id: string): Promise<LocationDto | null> {
    const location = await this.locationRepository.findOne({ where: { id } });
    return location ? this.mapLocationToDto(location) : null;
  }

  async updateLocation(id: string, input: UpdateLocationInput): Promise<LocationDto> {
    try {
      return await this.transactionService.run(async (manager) => {
        const locationRepo = manager.getRepository(Location);

        const location = await locationRepo.findOne({ where: { id } });
        if (!location) throw AppException.notFound("Location");

        const before = { name: location.name, isDefault: location.isDefault, isActive: location.isActive };
        const nextActive = input.isActive ?? location.isActive;
        const nextDefault = input.isDefault ?? location.isDefault;

        if (nextDefault && !nextActive) {
          throw AppException.conflict("INVALID_DEFAULT_LOCATION", "The default location must be active");
        }

        const losesDefault = location.isDefault && (!nextDefault || !nextActive);
        const becomesDefault = !location.isDefault && nextDefault;

        if (losesDefault) {
          // Only allowed when another active location is named as the new default in this same transaction.
          if (!input.replacementDefaultId || input.replacementDefaultId === id) {
            throw AppException.conflict(
              "DEFAULT_LOCATION_REQUIRED",
              "Name another active location as replacementDefaultId to deactivate or unset the default location",
            );
          }
          const replacement = await locationRepo.findOne({ where: { id: input.replacementDefaultId } });
          if (!replacement) throw AppException.notFound("Replacement location");
          if (!replacement.isActive) {
            throw AppException.conflict("INVALID_DEFAULT_LOCATION", "The replacement default location must be active");
          }
          if (!nextActive) await this.assertCanDeactivate(manager, location);
          location.isDefault = false;
          location.isActive = nextActive;
          await locationRepo.save(location);
          replacement.isDefault = true;
          await locationRepo.save(replacement);
        } else {
          if (becomesDefault) {
            const currentDefault = await locationRepo.findOne({ where: { isDefault: true } });
            if (currentDefault && currentDefault.id !== id) {
              currentDefault.isDefault = false;
              await locationRepo.save(currentDefault);
            }
            location.isDefault = true;
          }
          if (!nextActive && location.isActive) {
            await this.assertCanDeactivate(manager, location);
            location.isActive = false;
          } else if (nextActive) {
            location.isActive = true;
          }
        }

        if (input.name) location.name = input.name;
        const updated = await locationRepo.save(location);

        await this.auditService.record(
          {
            action: "location:update",
            entityType: "Location",
            entityId: id,
            diff: {
              before,
              after: { name: updated.name, isDefault: updated.isDefault, isActive: updated.isActive },
            },
          },
          manager,
        );

        // deactivating a location changes the available stock of every variant stocked there
        this.catalogRevalidation.invalidate(manager);
        return this.mapLocationToDto(updated);
      });
    } catch (e) {
      throw this.translateDefaultRace(e);
    }
  }

  private async assertCanDeactivate(manager: EntityManager, location: Location): Promise<void> {
    const rows = await manager.query<{ on_hand: number; reserved: number }[]>(
      `SELECT COALESCE(SUM(on_hand), 0)::int AS on_hand, COALESCE(SUM(reserved), 0)::int AS reserved
       FROM inventory_levels WHERE location_id = $1`,
      [location.id],
    );
    if ((rows[0]?.reserved ?? 0) > 0) {
      throw AppException.conflict("LOCATION_HAS_RESERVED_STOCK", "Cannot deactivate a location with reserved stock");
    }
    if (location.isDefault && (rows[0]?.on_hand ?? 0) > 0) {
      throw AppException.conflict(
        "CANNOT_DEACTIVATE_DEFAULT_WITH_STOCK",
        "Cannot deactivate the default location while it has stock",
      );
    }
    const otherActive = await manager
      .getRepository(Location)
      .count({ where: { isActive: true, id: Not(location.id) } });
    if (otherActive === 0) {
      throw AppException.conflict("CANNOT_DEACTIVATE_ONLY_ACTIVE", "Cannot deactivate the only active location");
    }
  }

  async deleteLocation(id: string): Promise<void> {
    await this.transactionService.run(async (manager) => {
      const locationRepo = manager.getRepository(Location);

      const location = await locationRepo.findOne({ where: { id } });
      if (!location) throw AppException.notFound("Location");

      if (location.isDefault) {
        throw AppException.conflict("CANNOT_DELETE_DEFAULT", "Cannot delete the default location");
      }
      if (location.isActive) {
        throw AppException.conflict("CANNOT_DELETE_ACTIVE", "Cannot delete an active location");
      }

      const levels = await manager.getRepository(InventoryLevel).count({ where: { locationId: id } });
      if (levels > 0) {
        throw AppException.conflict("LOCATION_HAS_INVENTORY", "Cannot delete a location that has inventory levels", {
          levels,
        });
      }

      await locationRepo.remove(location);

      await this.auditService.record({ action: "location:delete", entityType: "Location", entityId: id }, manager);
    });
  }

  private translateDefaultRace(e: unknown): unknown {
    if (e instanceof QueryFailedError && (e.driverError as { code?: string } | undefined)?.code === "23505") {
      return AppException.conflict("DEFAULT_LOCATION_CONFLICT", "Another request changed the default location; retry");
    }
    return e;
  }

  /* ── Inventory Adjustments ─────────────────────────────────── */

  async adjustInventory(input: AdjustInventoryInput, actorId?: string): Promise<InventoryAdjustmentDto> {
    if ((input.delta === undefined) === (input.setTo === undefined)) {
      throw AppException.badRequest("INVALID_ADJUSTMENT", "Provide exactly one of delta or setTo");
    }

    return this.transactionService.run(async (manager) => {
      const adjRepo = manager.getRepository(InventoryAdjustment);

      const variant = await manager.getRepository(Variant).findOne({ where: { id: input.variantId } });
      if (!variant) throw AppException.notFound("Variant");

      const location = await manager.getRepository(Location).findOne({ where: { id: input.locationId } });
      if (!location) throw AppException.notFound("Location");
      if (!location.isActive) throw AppException.conflict("LOCATION_INACTIVE", "Location is not active");

      // Create the level if missing (race-safe), then lock it.
      const now = this.clock.now();
      await manager.query(
        `INSERT INTO inventory_levels (id, variant_id, location_id, on_hand, reserved, version, created_at, updated_at)
         VALUES ($1, $2, $3, 0, 0, 1, $4, $4)
         ON CONFLICT (variant_id, location_id) DO NOTHING`,
        [uuidv7(), input.variantId, input.locationId, now],
      );
      const locked = await manager.query<{ id: string; on_hand: number; reserved: number }[]>(
        `SELECT id, on_hand, reserved FROM inventory_levels WHERE variant_id = $1 AND location_id = $2 FOR UPDATE`,
        [input.variantId, input.locationId],
      );
      const row = locked[0];
      if (!row) throw AppException.conflict("CONCURRENT_UPDATE", "Inventory level was not created");

      const delta = input.delta ?? (input.setTo ?? 0) - row.on_hand;
      const newOnHand = row.on_hand + delta;

      if (delta === 0) throw AppException.badRequest("NO_CHANGE", "The adjustment does not change on_hand");
      if (newOnHand < 0) {
        throw AppException.conflict("INSUFFICIENT_STOCK", "Cannot reduce on_hand below 0", { onHand: row.on_hand, delta });
      }
      if (newOnHand < row.reserved) {
        throw AppException.conflict("INSUFFICIENT_STOCK", "Cannot set on_hand below reserved quantity", {
          onHand: row.on_hand,
          reserved: row.reserved,
          delta,
        });
      }
      if (newOnHand > MAX_ON_HAND) {
        throw AppException.badRequest("QUANTITY_TOO_LARGE", `on_hand cannot exceed ${MAX_ON_HAND}`);
      }

      await manager.query(
        `UPDATE inventory_levels SET on_hand = $2, updated_at = $3, version = version + 1 WHERE id = $1`,
        [row.id, newOnHand, now],
      );

      const adjustment = new InventoryAdjustment();
      adjustment.variantId = input.variantId;
      adjustment.locationId = input.locationId;
      adjustment.delta = delta;
      adjustment.reason = input.reason;
      adjustment.note = input.note ?? null;
      adjustment.actorId = actorId ?? null;
      const saved = await adjRepo.save(adjustment);

      await this.auditService.record(
        {
          action: "inventory:adjust",
          entityType: "InventoryLevel",
          entityId: row.id,
          diff: { delta, newOnHand, reason: input.reason, note: input.note },
        },
        manager,
      );

      this.catalogRevalidation.invalidate(manager, { variantIds: [input.variantId] });
      const product = await manager.getRepository(Product).findOne({
        where: { id: variant.productId },
        withDeleted: true,
        select: { id: true, title: true, handle: true },
      });
      return this.mapAdjustmentToDto(saved, variant, product ?? undefined);
    });
  }

  async listInventoryLevels(params: InventoryQueryParams): Promise<OffsetPage<InventoryLevelDto>> {
    const { page, pageSize, q, locationId, variantId, productId, lowStock, lowStockThreshold } = params;
    const offset = (page - 1) * pageSize;

    const query = this.inventoryLevelRepository
      .createQueryBuilder("level")
      .leftJoinAndSelect("level.variant", "variant")
      .leftJoin("variant.product", "product")
      .addSelect(["product.id", "product.title", "product.handle"])
      .leftJoinAndSelect("level.location", "location")
      .where("variant.isActive = true");

    if (locationId) query.andWhere("level.locationId = :locationId", { locationId });
    if (variantId) query.andWhere("level.variantId = :variantId", { variantId });
    if (productId) query.andWhere("variant.productId = :productId", { productId });

    if (q) {
      query.andWhere("(variant.sku ILIKE :q ESCAPE '\\' OR variant.title ILIKE :q ESCAPE '\\')", {
        q: `%${escapeLike(q)}%`,
      });
    }

    if (lowStock === true) {
      query.andWhere("(level.onHand - level.reserved) <= :threshold", { threshold: lowStockThreshold });
    }

    const total = await query.clone().getCount();
    const items = await query
      .orderBy("variant.title", "ASC")
      .addOrderBy("location.name", "ASC")
      .addOrderBy("level.id", "ASC")
      .skip(offset)
      .take(pageSize)
      .getMany();

    return toOffsetPage(
      items.map((item) => this.mapInventoryLevelToDto(item, lowStock === true ? lowStockThreshold : LOW_STOCK_DEFAULT)),
      total,
      page,
      pageSize,
    );
  }

  async listAdjustments(limit: number, cursor?: string, variantId?: string): Promise<CursorPage<InventoryAdjustmentDto>> {
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (variantId) {
      params.push(variantId);
      conditions.push(`a.variant_id = $${params.length}::uuid`);
    }
    if (cursor) {
      const cursorData = decodeCursor(cursor, z.object({ c: z.string().datetime(), id: z.string().uuid() }));
      params.push(cursorData.c, cursorData.id);
      conditions.push(`(a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(limit + 1);

    // One JOIN query (variant + product, soft-deleted products included): no per-row lookups.
    const rows = await this.adjustmentRepository.manager.query<AdjustmentRow[]>(
      `SELECT a.id, a.variant_id, a.location_id, a.delta, a.reason, a.note, a.actor_id, a.created_at,
              v.title AS variant_title, p.id AS product_id, p.title AS product_title, p.handle AS product_handle
         FROM inventory_adjustments a
         LEFT JOIN variants v ON v.id = a.variant_id
         LEFT JOIN products p ON p.id = v.product_id
        ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${params.length}`,
      params,
    );

    return toCursorPage(
      rows.map(
        (r): InventoryAdjustmentDto => ({
          id: r.id,
          variantId: r.variant_id,
          variantTitle: r.variant_title ?? null,
          productId: r.product_id ?? null,
          productTitle: r.product_title ?? null,
          productHandle: r.product_handle ?? null,
          locationId: r.location_id,
          delta: r.delta,
          reason: r.reason,
          note: r.note ?? null,
          actorId: r.actor_id ?? null,
          createdAt: r.created_at,
        }),
      ),
      limit,
      (last) => ({ c: last.createdAt.toISOString(), id: last.id }),
    );
  }

  /* ── Reserve / Release / Commit ────────────────────────────── */

  private normalizeItems(items: { variantId: string; quantity: number }[]): { variantId: string; quantity: number }[] {
    const merged = new Map<string, number>();
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > MAX_ON_HAND) {
        throw AppException.badRequest("INVALID_QUANTITY", "quantity must be a positive integer", {
          variantId: item.variantId,
          quantity: item.quantity,
        });
      }
      merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
    }
    // Sorted by variantId: consistent lock order prevents deadlocks.
    return [...merged.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([variantId, quantity]) => ({ variantId, quantity }));
  }

  /** Variants that can be bought: active variant of a live, published product (same rule as the storefront). */
  private async sellableVariantIds(variantIds: string[]): Promise<Set<string>> {
    if (variantIds.length === 0) return new Set();
    const rows = await this.variantRepository.manager.query<{ id: string }[]>(
      `SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id
       WHERE v.id = ANY($1::uuid[]) AND v.is_active = true AND p.status = 'active' AND p.deleted_at IS NULL`,
      [variantIds],
    );
    return new Set(rows.map((r) => r.id));
  }

  /** Variants whose stock is not tracked or that allow backorder are never reserved/released/committed. */
  private async trackedItems(
    items: { variantId: string; quantity: number }[],
    manager: EntityManager,
  ): Promise<{ variantId: string; quantity: number }[]> {
    if (items.length === 0) return [];
    const variants = await manager.getRepository(Variant).find({ where: { id: In(items.map((i) => i.variantId)) } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    return items.filter((item) => {
      const v = byId.get(item.variantId);
      if (!v) throw AppException.notFound("Variant");
      return v.trackInventory && !v.allowBackorder;
    });
  }

  /** Locks the variant's levels in a stable order (default location first). */
  private async lockLevels(
    manager: EntityManager,
    variantId: string,
    activeOnly: boolean,
  ): Promise<{ id: string; location_id: string; on_hand: number; reserved: number }[]> {
    return manager.query(
      `SELECT il.id, il.location_id, il.on_hand, il.reserved
       FROM inventory_levels il JOIN locations l ON l.id = il.location_id
       WHERE il.variant_id = $1 ${activeOnly ? "AND l.is_active = true" : ""}
       ORDER BY l.is_default DESC, l.created_at ASC, l.id ASC
       FOR UPDATE OF il`,
      [variantId],
    );
  }

  /** Reserves stock and returns what was ACTUALLY reserved (untracked / backorderable variants are skipped). */
  async reserve(
    items: { variantId: string; quantity: number }[],
    manager: EntityManager,
  ): Promise<{ variantId: string; quantity: number }[]> {
    const normalized = this.normalizeItems(items);
    // only sellable variants can be newly reserved (release/commit must keep working for older reservations)
    const sellable = await this.sellableVariantIds(normalized.map((i) => i.variantId));
    const unsellable = normalized.filter((i) => !sellable.has(i.variantId)).map((i) => i.variantId);
    if (unsellable.length > 0) {
      throw AppException.conflict("VARIANT_UNAVAILABLE", "Some variants are no longer available", { variantIds: unsellable });
    }
    const tracked = await this.trackedItems(normalized, manager);
    const short: { variantId: string; requested: number; available: number }[] = [];
    const now = this.clock.now();

    for (const item of tracked) {
      const levels = await this.lockLevels(manager, item.variantId, true);
      let remaining = item.quantity;
      let available = 0;
      for (const level of levels) {
        const free = level.on_hand - level.reserved;
        available += Math.max(0, free);
        const take = Math.min(remaining, Math.max(0, free));
        if (take <= 0) continue;
        const res = await manager.query<unknown[]>(
          `UPDATE inventory_levels SET reserved = reserved + $2, version = version + 1, updated_at = $3
           WHERE id = $1 AND on_hand - reserved >= $2 RETURNING id`,
          [level.id, take, now],
        );
        if (affectedCount(res) === 0) continue;
        remaining -= take;
        if (remaining === 0) break;
      }
      if (remaining > 0) short.push({ variantId: item.variantId, requested: item.quantity, available });
    }

    if (short.length > 0) {
      throw AppException.conflict("INSUFFICIENT_STOCK", "Not enough stock for some items", { items: short });
    }
    this.catalogRevalidation.invalidate(manager, { variantIds: tracked.map((i) => i.variantId) });
    return tracked;
  }

  /** Releases using the CURRENT variant policy (legacy). Prefer `releaseReserved` for orders. */
  async release(items: { variantId: string; quantity: number }[], manager: EntityManager): Promise<void> {
    await this.releaseReserved(await this.trackedItems(this.normalizeItems(items), manager), manager);
  }

  /** Releases exactly the given quantities without looking at the variants' current policy flags. */
  async releaseReserved(items: { variantId: string; quantity: number }[], manager: EntityManager): Promise<void> {
    const tracked = items.length === 0 ? [] : this.normalizeItems(items);
    const short: { variantId: string; requested: number; reserved: number }[] = [];
    const now = this.clock.now();

    for (const item of tracked) {
      const levels = await this.lockLevels(manager, item.variantId, false);
      const reserved = levels.reduce((sum, l) => sum + l.reserved, 0);
      if (reserved < item.quantity) {
        short.push({ variantId: item.variantId, requested: item.quantity, reserved });
        continue;
      }
      let remaining = item.quantity;
      for (const level of levels) {
        const take = Math.min(remaining, level.reserved);
        if (take <= 0) continue;
        const res = await manager.query<unknown[]>(
          `UPDATE inventory_levels SET reserved = reserved - $2, version = version + 1, updated_at = $3
           WHERE id = $1 AND reserved >= $2 RETURNING id`,
          [level.id, take, now],
        );
        if (affectedCount(res) === 0) throw AppException.conflict("INSUFFICIENT_RESERVED", "Reserved stock changed concurrently");
        remaining -= take;
        if (remaining === 0) break;
      }
    }

    if (short.length > 0) {
      throw AppException.conflict("INSUFFICIENT_RESERVED", "Reserved quantity is lower than the quantity to release", {
        items: short,
      });
    }
    this.catalogRevalidation.invalidate(manager, { variantIds: tracked.map((i) => i.variantId) });
  }

  /** Commits using the CURRENT variant policy (legacy). Prefer `commitReserved` for orders. */
  async commit(items: { variantId: string; quantity: number }[], manager: EntityManager): Promise<void> {
    await this.commitReserved(await this.trackedItems(this.normalizeItems(items), manager), manager);
  }

  /** Commits (on_hand and reserved decrease) exactly the given quantities without looking at current policy flags. */
  async commitReserved(items: { variantId: string; quantity: number }[], manager: EntityManager): Promise<void> {
    const tracked = items.length === 0 ? [] : this.normalizeItems(items);
    const short: { variantId: string; requested: number; reserved: number }[] = [];
    const adjRepo = manager.getRepository(InventoryAdjustment);
    const now = this.clock.now();

    for (const item of tracked) {
      const levels = await this.lockLevels(manager, item.variantId, false);
      const reserved = levels.reduce((sum, l) => sum + l.reserved, 0);
      if (reserved < item.quantity) {
        short.push({ variantId: item.variantId, requested: item.quantity, reserved });
        continue;
      }
      let remaining = item.quantity;
      for (const level of levels) {
        const take = Math.min(remaining, level.reserved);
        if (take <= 0) continue;
        const res = await manager.query<unknown[]>(
          `UPDATE inventory_levels
           SET on_hand = on_hand - $2, reserved = reserved - $2, version = version + 1, updated_at = $3
           WHERE id = $1 AND reserved >= $2 RETURNING id`,
          [level.id, take, now],
        );
        if (affectedCount(res) === 0) throw AppException.conflict("INSUFFICIENT_RESERVED", "Reserved stock changed concurrently");

        const adjustment = new InventoryAdjustment();
        adjustment.variantId = item.variantId;
        adjustment.locationId = level.location_id;
        adjustment.delta = -take;
        adjustment.reason = "sold";
        adjustment.note = null;
        adjustment.actorId = null;
        await adjRepo.save(adjustment);

        remaining -= take;
        if (remaining === 0) break;
      }
    }

    if (short.length > 0) {
      throw AppException.conflict("INSUFFICIENT_RESERVED", "Insufficient reserved quantity", { items: short });
    }
    this.catalogRevalidation.invalidate(manager, { variantIds: tracked.map((i) => i.variantId) });
  }

  /**
   * Adds stock back to `on_hand` in the active default location (cancelled paid orders, refunds with restock).
   * Untracked / backorderable variants are skipped, like `commit`. Locks in variantId order and records an
   * InventoryAdjustment per item.
   */
  async restock(
    items: { variantId: string; quantity: number }[],
    manager: EntityManager,
    reason: "returned" | "correction",
  ): Promise<void> {
    const tracked = await this.trackedItems(this.normalizeItems(items), manager);
    if (tracked.length === 0) return;

    const defaults = await manager.query<{ id: string }[]>(
      `SELECT id FROM locations WHERE is_default = true AND is_active = true LIMIT 1`,
    );
    const locationId = defaults[0]?.id;
    if (!locationId) throw AppException.conflict("NO_DEFAULT_LOCATION", "There is no active default location to restock into");

    const adjRepo = manager.getRepository(InventoryAdjustment);
    const now = this.clock.now();

    for (const item of tracked) {
      await manager.query(
        `INSERT INTO inventory_levels (id, variant_id, location_id, on_hand, reserved, version, created_at, updated_at)
         VALUES ($1, $2, $3, 0, 0, 1, $4, $4)
         ON CONFLICT (variant_id, location_id) DO NOTHING`,
        [uuidv7(), item.variantId, locationId, now],
      );
      const locked = await manager.query<{ id: string; on_hand: number }[]>(
        `SELECT id, on_hand FROM inventory_levels WHERE variant_id = $1 AND location_id = $2 FOR UPDATE`,
        [item.variantId, locationId],
      );
      const row = locked[0];
      if (!row) throw AppException.conflict("CONCURRENT_UPDATE", "Inventory level was not created");
      if (row.on_hand + item.quantity > MAX_ON_HAND) {
        throw AppException.badRequest("QUANTITY_TOO_LARGE", `on_hand cannot exceed ${MAX_ON_HAND}`);
      }

      await manager.query(
        `UPDATE inventory_levels SET on_hand = on_hand + $2, version = version + 1, updated_at = $3 WHERE id = $1`,
        [row.id, item.quantity, now],
      );

      const adjustment = new InventoryAdjustment();
      adjustment.variantId = item.variantId;
      adjustment.locationId = locationId;
      adjustment.delta = item.quantity;
      adjustment.reason = reason;
      adjustment.note = null;
      adjustment.actorId = null;
      await adjRepo.save(adjustment);
    }
    this.catalogRevalidation.invalidate(manager, { variantIds: tracked.map((i) => i.variantId) });
  }

  /**
   * Availability per variant, summed over ALL active locations (same rule as the storefront):
   * SUM(on_hand - reserved). Variants with trackInventory=false or allowBackorder=true are
   * `unlimited: true` (never out of stock); unknown variants yield available 0.
   */
  async availabilityFor(variantIds: string[]): Promise<Map<string, { available: number; unlimited: boolean }>> {
    const result = new Map<string, { available: number; unlimited: boolean }>();
    if (variantIds.length === 0) return result;

    const variants = await this.variantRepository.find({ where: { id: In(variantIds) } });
    const sellable = await this.sellableVariantIds(variantIds);
    const policy = new Map(variants.map((v) => [v.id, sellable.has(v.id) && (!v.trackInventory || v.allowBackorder)]));

    const rows = await this.inventoryLevelRepository.manager.query<{ variant_id: string; available: number }[]>(
      `SELECT il.variant_id, COALESCE(SUM(il.on_hand - il.reserved), 0)::bigint AS available
       FROM inventory_levels il JOIN locations l ON l.id = il.location_id AND l.is_active = true
       WHERE il.variant_id = ANY($1::uuid[])
       GROUP BY il.variant_id`,
      [variantIds],
    );
    const sums = new Map(rows.map((r) => [r.variant_id, Math.max(0, Number(r.available))]));

    for (const id of variantIds) {
      result.set(id, { available: sellable.has(id) ? (sums.get(id) ?? 0) : 0, unlimited: policy.get(id) === true });
    }
    return result;
  }

  /** Same as availabilityFor, but unlimited variants report UNLIMITED_AVAILABILITY (a very large number). */
  async availableFor(variantIds: string[]): Promise<Map<string, number>> {
    const detailed = await this.availabilityFor(variantIds);
    return new Map([...detailed].map(([id, v]) => [id, v.unlimited ? UNLIMITED_AVAILABILITY : v.available]));
  }

  /* ── Private helpers ───────────────────────────────────────── */

  private mapLocationToDto(location: Location): LocationDto {
    return {
      id: location.id,
      name: location.name,
      isDefault: location.isDefault,
      isActive: location.isActive,
      createdAt: location.createdAt,
      updatedAt: location.updatedAt,
    };
  }

  private mapInventoryLevelToDto(level: InventoryLevel, lowStockThreshold: number): InventoryLevelDto {
    const available = Math.max(0, level.onHand - level.reserved);
        return {
      id: level.id,
      variantId: level.variantId,
      variantTitle: level.variant?.title ?? "",
      variantSku: level.variant?.sku ?? null,
      productId: level.variant?.product?.id ?? null,
      productTitle: level.variant?.product?.title ?? null,
      productHandle: level.variant?.product?.handle ?? null,
      locationId: level.locationId,
      locationName: level.location?.name ?? "",
      onHand: level.onHand,
      reserved: level.reserved,
      lowStock: available <= lowStockThreshold,
      createdAt: level.createdAt,
      updatedAt: level.updatedAt,
    };
  }

  private mapAdjustmentToDto(
    adjustment: InventoryAdjustment,
    variant: Variant | undefined,
    product?: Pick<Product, "id" | "title" | "handle">,
  ): InventoryAdjustmentDto {
    return {
      id: adjustment.id,
      variantId: adjustment.variantId,
      variantTitle: variant?.title ?? null,
      productId: product?.id ?? null,
      productTitle: product?.title ?? null,
      productHandle: product?.handle ?? null,
      locationId: adjustment.locationId,
      delta: adjustment.delta,
      reason: adjustment.reason,
      note: adjustment.note ?? null,
      actorId: adjustment.actorId ?? null,
      createdAt: adjustment.createdAt,
    };
  }

}
