import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { RevalidationService } from "../../cms/content/revalidation.service";
import { TransactionService } from "../../database/transaction.service";

export const CATALOG_TAG = "catalog";
export const CATALOG_PRODUCTS_TAG = "catalog:products";
export const CATALOG_COLLECTIONS_TAG = "catalog:collections";
export const productTag = (handle: string): string => `catalog:product:${handle}`;
export const collectionTag = (handle: string): string => `catalog:collection:${handle}`;

/** Edits made within this window travel to the storefront as ONE deduplicated batch. */
const DEBOUNCE_MS = 1500;

interface Pending {
  products: boolean;
  collections: boolean;
  productIds: Set<string>;
  variantIds: Set<string>;
  productHandles: Set<string>;
  collectionIds: Set<string>;
  collectionHandles: Set<string>;
}

const emptyPending = (): Pending => ({
  products: false,
  collections: false,
  productIds: new Set(),
  variantIds: new Set(),
  productHandles: new Set(),
  collectionIds: new Set(),
  collectionHandles: new Set(),
});

export interface ProductChange {
  productIds?: string[];
  variantIds?: string[];
  /** Handles that cannot be resolved from the database afterwards (e.g. the previous handle after a rename). */
  handles?: string[];
}

export interface CollectionChange {
  collectionIds?: string[];
  handles?: string[];
}

/**
 * Tells the storefront which catalog cache tags went stale. Every method takes the caller's transaction manager and
 * only records the change AFTER that transaction commits; changes are then coalesced for DEBOUNCE_MS, resolved to
 * handles in one query per kind and delivered by RevalidationService (signed, retried, split in batches).
 * Never blocks nor fails the admin request.
 */
@Injectable()
export class CatalogCacheService implements OnApplicationShutdown {
  private readonly logger = new Logger(CatalogCacheService.name);
  private pending = emptyPending();
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly tx: TransactionService,
    private readonly revalidation: RevalidationService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  productsChanged(manager: EntityManager, change: ProductChange): void {
    this.tx.afterCommit(manager, () => {
      this.pending.products = true;
      for (const id of change.productIds ?? []) this.pending.productIds.add(id);
      for (const id of change.variantIds ?? []) this.pending.variantIds.add(id);
      for (const h of change.handles ?? []) this.pending.productHandles.add(h);
      this.arm();
    });
  }

  collectionsChanged(manager: EntityManager, change: CollectionChange): void {
    this.tx.afterCommit(manager, () => {
      this.pending.collections = true;
      for (const id of change.collectionIds ?? []) this.pending.collectionIds.add(id);
      for (const h of change.handles ?? []) this.pending.collectionHandles.add(h);
      this.arm();
    });
  }

  /** Something that touches an unknown set of products and collections (imports, media, locations). */
  everythingChanged(manager: EntityManager): void {
    this.tx.afterCommit(manager, () => {
      this.pending.products = true;
      this.pending.collections = true;
      this.arm();
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private arm(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  /** Public for tests and shutdown: sends whatever is pending right now. */
  flush(): Promise<void> {
    const batch = this.pending;
    this.pending = emptyPending();
    if (!batch.products && !batch.collections) return this.inFlight;
    this.inFlight = this.inFlight.then(() => this.send(batch)).catch(() => undefined);
    return this.inFlight;
  }

  private async send(batch: Pending): Promise<void> {
    const tags = new Set<string>([CATALOG_TAG]);
    if (batch.products) tags.add(CATALOG_PRODUCTS_TAG);
    if (batch.collections) tags.add(CATALOG_COLLECTIONS_TAG);
    for (const h of batch.productHandles) tags.add(productTag(h));
    for (const h of batch.collectionHandles) tags.add(collectionTag(h));
    try {
      for (const h of await this.productHandles(batch)) tags.add(productTag(h));
      for (const h of await this.collectionHandles(batch)) tags.add(collectionTag(h));
    } catch (err) {
      this.logger.warn(`Could not resolve catalog handles, sending the broad tags only: ${err instanceof Error ? err.message : String(err)}`);
      tags.add(CATALOG_PRODUCTS_TAG);
      tags.add(CATALOG_COLLECTIONS_TAG);
    }
    await this.revalidation.notifyMany(tags);
  }

  private async productHandles(batch: Pending): Promise<string[]> {
    const handles: string[] = [];
    if (batch.productIds.size > 0) {
      const rows = await this.dataSource.query<{ handle: string }[]>("SELECT handle FROM products WHERE id = ANY($1::uuid[])", [[...batch.productIds]]);
      handles.push(...rows.map((r) => r.handle));
    }
    if (batch.variantIds.size > 0) {
      const rows = await this.dataSource.query<{ handle: string }[]>(
        "SELECT DISTINCT p.handle FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1::uuid[])",
        [[...batch.variantIds]],
      );
      handles.push(...rows.map((r) => r.handle));
    }
    return handles;
  }

  private async collectionHandles(batch: Pending): Promise<string[]> {
    if (batch.collectionIds.size === 0) return [];
    const rows = await this.dataSource.query<{ handle: string }[]>("SELECT handle FROM collections WHERE id = ANY($1::uuid[])", [[...batch.collectionIds]]);
    return rows.map((r) => r.handle);
  }
}
