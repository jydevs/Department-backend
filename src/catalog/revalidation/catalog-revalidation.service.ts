import { Injectable, Logger } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { RevalidationService } from "../../cms/content/revalidation.service";
import { AFTER_COMMIT_KEY, afterCommit } from "../../database/transaction.service";

/** What changed; resolved to storefront cache tags AFTER the transaction committed. */
export interface CatalogChange {
  productIds?: string[];
  variantIds?: string[];
  collectionIds?: string[];
  /** Extra tags / handles that can no longer be resolved from the DB (e.g. the previous handle after a rename). */
  productHandles?: string[];
  collectionHandles?: string[];
  /**
   * Only the stock of these variants moved (reserve / commit / restock / adjustment): revalidate just their product pages
   * (and manual collections), not the whole `catalog` tag. Any other change in the same transaction still sends `catalog`.
   */
  stockOnly?: boolean;
}

type PendingChange = Required<Omit<CatalogChange, "stockOnly">> & { broad: boolean };

/** Same whitelist the storefront applies to /api/revalidate for catalog tags. */
const CATALOG_TAG = /^(catalog|catalog:(product|collection):[a-z0-9-]+)$/;
const MAX_SPECIFIC_TAGS = 200;
const PENDING_KEY = "catalogChanges";

const emptyChange = (): PendingChange => ({
  broad: false,
  productIds: [],
  variantIds: [],
  collectionIds: [],
  productHandles: [],
  collectionHandles: [],
});

/**
 * Sends `catalog`, `catalog:product:<handle>` and `catalog:collection:<handle>` to the storefront after a catalog
 * change COMMITTED. Changes made in one transaction are merged into a single request (duplicate tags removed).
 * Best effort: never throws, never blocks the response, a no-op without STOREFRONT_REVALIDATE_SECRET.
 */
@Injectable()
export class CatalogRevalidationService {
  private readonly logger = new Logger(CatalogRevalidationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly revalidation: RevalidationService,
  ) {}

  /** Call inside the transaction (pass its manager) or without one for a standalone change. */
  invalidate(manager: EntityManager | undefined, change: CatalogChange = {}): void {
    const data = manager?.queryRunner?.data;
    if (data && Array.isArray(data[AFTER_COMMIT_KEY])) {
      let pending = data[PENDING_KEY] as PendingChange | undefined;
      if (!pending) {
        pending = emptyChange();
        data[PENDING_KEY] = pending;
        const captured = pending;
        afterCommit(manager, () => this.flush(captured));
      }
      this.merge(pending, change);
      return;
    }
    const own = emptyChange();
    this.merge(own, change);
    void this.flush(own);
  }

  private merge(into: PendingChange, change: CatalogChange): void {
    if (!change.stockOnly) into.broad = true;
    into.productIds.push(...(change.productIds ?? []));
    into.variantIds.push(...(change.variantIds ?? []));
    into.collectionIds.push(...(change.collectionIds ?? []));
    into.productHandles.push(...(change.productHandles ?? []));
    into.collectionHandles.push(...(change.collectionHandles ?? []));
  }

  private async flush(change: PendingChange): Promise<void> {
    try {
      const tags = await this.resolveTags(change);
      if (tags.length > 0) await this.revalidation.notify(tags);
    } catch (err) {
      this.logger.warn(`Catalog revalidation error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async resolveTags(change: PendingChange): Promise<string[]> {
    const productIds = [...new Set(change.productIds)];
    const variantIds = [...new Set(change.variantIds)];
    const collectionIds = [...new Set(change.collectionIds)];
    const productHandles = new Set(change.productHandles);
    const collectionHandles = new Set(change.collectionHandles);

    // Soft-deleted rows are included on purpose (their storefront page has to be dropped too).
    if (productIds.length > 0 || variantIds.length > 0) {
      const rows: { id: string; handle: string }[] = await this.dataSource.query(
        `SELECT p.id, p.handle FROM products p WHERE p.id = ANY($1::uuid[])
         UNION
         SELECT p.id, p.handle FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($2::uuid[])`,
        [productIds, variantIds],
      );
      for (const r of rows) productHandles.add(r.handle);
      const allProductIds = [...new Set([...productIds, ...rows.map((r) => r.id)])];
      // Manual collections that contain the product (smart ones are covered by the generic `catalog` tag).
      const members: { handle: string }[] = await this.dataSource.query(
        `SELECT DISTINCT c.handle FROM collection_products cp JOIN collections c ON c.id = cp.collection_id
          WHERE cp.product_id = ANY($1::uuid[])`,
        [allProductIds],
      );
      for (const r of members) collectionHandles.add(r.handle);
    }
    if (collectionIds.length > 0) {
      const rows: { handle: string }[] = await this.dataSource.query(`SELECT handle FROM collections WHERE id = ANY($1::uuid[])`, [collectionIds]);
      for (const r of rows) collectionHandles.add(r.handle);
    }

    const specific = [
      ...[...productHandles].map((h) => `catalog:product:${h}`),
      ...[...collectionHandles].map((h) => `catalog:collection:${h}`),
    ].filter((t) => CATALOG_TAG.test(t));

    // A huge bulk change: one generic tag is cheaper than hundreds of specific ones.
    if (specific.length > MAX_SPECIFIC_TAGS) return ["catalog"];
    return change.broad ? ["catalog", ...specific] : specific;
  }
}
