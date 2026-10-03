import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, QueryFailedError, Repository } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { Collection, CollectionProduct, Product } from "../../catalog/entities";
import { OffsetPage, toOffsetPage } from "../../common/pagination/pagination";
import { AppException } from "../../common/errors/app-exception";
import { sanitizeRichText } from "../../common/html/sanitize";
import { SqlParams } from "../../common/sql/sql-params";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { CatalogCacheService } from "../cache/catalog-cache.service";
import {
  CollectionCreateInput,
  CollectionUpdateInput,
  CollectionProductsUpdateInput,
  CollectionDto,
  PreviewRulesInput,
  PreviewRulesResponseDto,
  CollectionMember,
  CollectionMembersAddInput,
  CollectionMembersAddResult,
  CollectionMemberReorderInput,
} from "./dto";
import { buildSmartRulesCondition } from "./smart-rules";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err.driverError as { code?: string } | undefined)?.code === "23505";
}

interface PreviewRow {
  id: string;
  handle: string;
  title: string;
  min_price: string | null;
  url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
}

@Injectable()
export class CollectionsService {
  constructor(
    @InjectRepository(Collection)
    private readonly collectionRepository: Repository<Collection>,
    private readonly dataSource: DataSource,
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
    private readonly cache: CatalogCacheService,
  ) {}

  async create(input: CollectionCreateInput): Promise<CollectionDto> {
    return this.transactionService.run(async (manager) => {
      const collectionRepo = manager.getRepository(Collection);

      // Check for duplicate handle
      const existing = await collectionRepo.findOne({ where: { handle: input.handle }, withDeleted: true });
      if (existing) {
        throw AppException.conflict("HANDLE_TAKEN", `Collection with handle "${input.handle}" already exists`);
      }

      if (input.type === "smart" && !input.rules) {
        throw AppException.badRequest("RULES_REQUIRED", "Smart collections require rules");
      }
      const collection = new Collection();
      collection.id = uuidv7();
      collection.handle = input.handle;
      collection.title = input.title;
      collection.descriptionHtml = sanitizeRichText(input.descriptionHtml ?? "");
      collection.type = input.type;
      collection.rules = input.type === "smart" ? (input.rules ?? null) : null;
      collection.sortOrder = input.sortOrder ?? "manual";
      collection.isPublished = input.isPublished;
      collection.seoTitle = input.seoTitle ?? null;
      collection.seoDescription = input.seoDescription ?? null;
      collection.imageMediaId = input.imageMediaId ?? null;

      const saved = await this.saveUnique(collectionRepo, collection, input.handle);

      await this.auditService.record(
        {
          action: "collection:create",
          entityType: "Collection",
          entityId: saved.id,
          diff: {
            handle: saved.handle,
            title: saved.title,
            type: saved.type,
          },
        },
        manager,
      );
      this.cache.collectionsChanged(manager, { collectionIds: [saved.id] });

      return this.mapToDto(saved);
    });
  }

  async update(id: string, input: CollectionUpdateInput): Promise<CollectionDto> {
    return this.transactionService.run(async (manager) => {
      const collectionRepo = manager.getRepository(Collection);

      const collection = await collectionRepo.findOne({ where: { id } });
      if (!collection) {
        throw AppException.notFound("Collection");
      }

      // Check for duplicate handle if changed
      if (input.handle !== undefined && input.handle !== collection.handle) {
        const existing = await collectionRepo.findOne({ where: { handle: input.handle }, withDeleted: true });
        if (existing) {
          throw AppException.conflict("HANDLE_TAKEN", `Collection with handle "${input.handle}" already exists`);
        }
      }

      const diff: Record<string, unknown> = {};
      const previousHandle = collection.handle;

      if (input.handle !== undefined && input.handle !== collection.handle) {
        diff.handle = { old: collection.handle, new: input.handle };
        collection.handle = input.handle;
      }
      if (input.title !== undefined && input.title !== collection.title) {
        diff.title = { old: collection.title, new: input.title };
        collection.title = input.title;
      }
      const cleanDescription = input.descriptionHtml !== undefined ? sanitizeRichText(input.descriptionHtml) : undefined;
      if (cleanDescription !== undefined && cleanDescription !== collection.descriptionHtml) {
        diff.descriptionHtml = { old: collection.descriptionHtml, new: cleanDescription };
        collection.descriptionHtml = cleanDescription;
      }
      if (input.type !== undefined && input.type !== collection.type) {
        diff.type = { old: collection.type, new: input.type };
        collection.type = input.type;
        collection.rules = null; // Clear rules when changing type
      }
      if (input.rules !== undefined) {
        diff.rules = { old: collection.rules, new: input.rules };
        collection.rules = input.rules;
      }
      if (input.sortOrder !== undefined && input.sortOrder !== collection.sortOrder) {
        diff.sortOrder = { old: collection.sortOrder, new: input.sortOrder };
        collection.sortOrder = input.sortOrder;
      }
      if (input.isPublished !== undefined && input.isPublished !== collection.isPublished) {
        diff.isPublished = { old: collection.isPublished, new: input.isPublished };
        collection.isPublished = input.isPublished;
      }
      if (input.seoTitle !== undefined && input.seoTitle !== collection.seoTitle) {
        diff.seoTitle = { old: collection.seoTitle, new: input.seoTitle };
        collection.seoTitle = input.seoTitle;
      }
      if (input.seoDescription !== undefined && input.seoDescription !== collection.seoDescription) {
        diff.seoDescription = { old: collection.seoDescription, new: input.seoDescription };
        collection.seoDescription = input.seoDescription;
      }
      if (input.imageMediaId !== undefined && input.imageMediaId !== collection.imageMediaId) {
        diff.imageMediaId = { old: collection.imageMediaId, new: input.imageMediaId };
        collection.imageMediaId = input.imageMediaId;
      }

      const updated = await this.saveUnique(collectionRepo, collection, input.handle ?? collection.handle);
      if (updated.type === "smart" && !updated.rules) {
        throw AppException.badRequest("RULES_REQUIRED", "Smart collections require rules");
      }

      if (Object.keys(diff).length > 0) {
        await this.auditService.record(
          {
            action: "collection:update",
            entityType: "Collection",
            entityId: updated.id,
            diff,
          },
          manager,
        );
        this.cache.collectionsChanged(manager, { collectionIds: [updated.id], handles: [previousHandle] });
      }

      return this.mapToDto(updated);
    });
  }

  async delete(id: string): Promise<void> {
    return this.transactionService.run(async (manager) => {
      const collectionRepo = manager.getRepository(Collection);

      const collection = await collectionRepo.findOne({ where: { id } });
      if (!collection) {
        throw AppException.notFound("Collection");
      }

      await collectionRepo.softRemove(collection);

      await this.auditService.record(
        {
          action: "collection:delete",
          entityType: "Collection",
          entityId: collection.id,
        },
        manager,
      );
      this.cache.collectionsChanged(manager, { handles: [collection.handle] });
    });
  }

  async findById(id: string): Promise<CollectionDto | null> {
    const collection = await this.collectionRepository.findOne({ where: { id } });
    return collection ? this.mapToDto(collection) : null;
  }

  async findByHandle(handle: string): Promise<CollectionDto | null> {
    const collection = await this.collectionRepository.findOne({ where: { handle } });
    return collection ? this.mapToDto(collection) : null;
  }

  async list(page: number, pageSize: number): Promise<{ items: CollectionDto[]; total: number }> {
    const [items, total] = await this.collectionRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { createdAt: "DESC" },
    });

    return {
      items: items.map((c) => this.mapToDto(c)),
      total,
    };
  }

  async updateProducts(collectionId: string, input: CollectionProductsUpdateInput): Promise<void> {
    return this.transactionService.run(async (manager) => {
      const collection = await manager.getRepository(Collection).findOne({ where: { id: collectionId } });
      if (!collection) {
        throw AppException.notFound("Collection");
      }
      if (collection.type !== "manual") {
        throw AppException.conflict("COLLECTION_NOT_MANUAL", "Products can only be set on manual collections");
      }

      const productIds = input.products.map((p) => p.productId);
      if (new Set(productIds).size !== productIds.length) {
        throw AppException.badRequest("DUPLICATE_PRODUCTS", "productIds must not contain duplicates");
      }
      if (productIds.length > 0) {
        const found = await manager.getRepository(Product).find({ where: { id: In(productIds) }, select: { id: true } });
        const foundIds = new Set(found.map((p) => p.id));
        const missing = productIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          throw AppException.badRequest("PRODUCTS_NOT_FOUND", "Some products do not exist", { productIds: missing });
        }
      }

      const collectionProductRepo = manager.getRepository(CollectionProduct);
      await collectionProductRepo.delete({ collectionId });
      if (productIds.length > 0) {
        await collectionProductRepo.insert(
          productIds.map((productId, position) => ({ id: uuidv7(), collectionId, productId, position })),
        );
      }

      await this.auditService.record(
        {
          action: "collection:update_products",
          entityType: "Collection",
          entityId: collectionId,
          diff: { productCount: productIds.length },
        },
        manager,
      );
      this.cache.collectionsChanged(manager, { collectionIds: [collectionId] });
    });
  }

  /** Members of a manual collection in every status (draft/active/archived), ordered by position. */
  async listMembers(collectionId: string, page: number, pageSize: number): Promise<OffsetPage<CollectionMember>> {
    const collection = await this.collectionRepository.findOne({ where: { id: collectionId }, select: { id: true } });
    if (!collection) {
      throw AppException.notFound("Collection");
    }
    const totalRows: { total: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM collection_products cp JOIN products p ON p.id = cp.product_id
       WHERE cp.collection_id = $1 AND p.deleted_at IS NULL`,
      [collectionId],
    );
    const rows: {
      id: string;
      handle: string;
      title: string;
      status: string;
      position: number;
      url: string | null;
      alt: string | null;
      width: number | null;
      height: number | null;
    }[] = await this.dataSource.query(
      `SELECT p.id, p.handle, p.title, p.status, cp.position, m.url, m.alt, m.width, m.height
       FROM collection_products cp
       JOIN products p ON p.id = cp.product_id AND p.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT md.url, md.alt, md.width, md.height
         FROM product_media pm JOIN media md ON md.id = pm.media_id
         WHERE pm.product_id = p.id
         ORDER BY pm.position ASC, pm.id ASC LIMIT 1
       ) m ON true
       WHERE cp.collection_id = $1
       ORDER BY cp.position ASC, cp.id ASC
       LIMIT $2 OFFSET $3`,
      [collectionId, pageSize, (page - 1) * pageSize],
    );
    const items = rows.map((r) => ({
      id: r.id,
      handle: r.handle,
      title: r.title,
      status: r.status,
      image: r.url ? { url: r.url, alt: r.alt ?? null, width: r.width ?? null, height: r.height ?? null } : null,
      position: Number(r.position),
    }));
    return toOffsetPage(items, totalRows[0]?.total ?? 0, page, pageSize);
  }

  /** Idempotent: products that are already members are reported and left where they are. */
  async addMembers(collectionId: string, input: CollectionMembersAddInput): Promise<CollectionMembersAddResult> {
    return this.transactionService.run(async (manager) => {
      const collection = await this.lockManualCollection(manager, collectionId);

      const requested = [...new Set(input.productIds)];
      const found = await manager.getRepository(Product).find({ where: { id: In(requested) }, select: { id: true } });
      const foundIds = new Set(found.map((p) => p.id));
      const missing = requested.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw AppException.badRequest("PRODUCTS_NOT_FOUND", "Some products do not exist", { productIds: missing });
      }

      const current = await this.memberIds(manager, collection.id);
      const currentSet = new Set(current);
      const added = requested.filter((id) => !currentSet.has(id));
      const alreadyMembers = requested.filter((id) => currentSet.has(id));

      if (added.length > 0) {
        const at = Math.min(input.position ?? current.length, current.length);
        const ordered = [...current.slice(0, at), ...added, ...current.slice(at)];
        await manager.getRepository(CollectionProduct).insert(
          added.map((productId) => ({ id: uuidv7(), collectionId: collection.id, productId, position: ordered.indexOf(productId) })),
        );
        await this.writePositions(manager, collection.id, ordered);

        await this.auditService.record(
          {
            action: "collection:add_products",
            entityType: "Collection",
            entityId: collection.id,
            diff: { added, position: input.position ?? null },
          },
          manager,
        );
        this.cache.collectionsChanged(manager, { collectionIds: [collection.id] });
      }
      return { added, alreadyMembers, total: current.length + added.length };
    });
  }

  /** Idempotent: removing a product that is not a member is a no-op (204). */
  async removeMember(collectionId: string, productId: string): Promise<void> {
    return this.transactionService.run(async (manager) => {
      const collection = await this.lockManualCollection(manager, collectionId);
      const result = await manager.getRepository(CollectionProduct).delete({ collectionId: collection.id, productId });
      if ((result.affected ?? 0) === 0) return;

      await this.writePositions(manager, collection.id, await this.memberIds(manager, collection.id));
      await this.auditService.record(
        {
          action: "collection:remove_product",
          entityType: "Collection",
          entityId: collection.id,
          diff: { productId },
        },
        manager,
      );
      this.cache.collectionsChanged(manager, { collectionIds: [collection.id] });
    });
  }

  /** Move one member to a new 0-based index; the rest keep their relative order. */
  async reorderMember(collectionId: string, input: CollectionMemberReorderInput): Promise<void> {
    return this.transactionService.run(async (manager) => {
      const collection = await this.lockManualCollection(manager, collectionId);
      const current = await this.memberIds(manager, collection.id);
      const from = current.indexOf(input.productId);
      if (from === -1) {
        throw AppException.notFound("Product");
      }
      const rest = current.filter((id) => id !== input.productId);
      const to = Math.min(input.position, rest.length);
      const ordered = [...rest.slice(0, to), input.productId, ...rest.slice(to)];
      if (ordered.every((id, i) => id === current[i])) return;

      await this.writePositions(manager, collection.id, ordered);
      await this.auditService.record(
        {
          action: "collection:reorder_product",
          entityType: "Collection",
          entityId: collection.id,
          diff: { productId: input.productId, from, to },
        },
        manager,
      );
      this.cache.collectionsChanged(manager, { collectionIds: [collection.id] });
    });
  }

  /** Row lock serialises concurrent membership edits; smart collections are rejected with a clear error. */
  private async lockManualCollection(manager: EntityManager, id: string): Promise<Collection> {
    const collection = await manager
      .getRepository(Collection)
      .createQueryBuilder("c")
      .setLock("pessimistic_write")
      .where("c.id = :id", { id })
      .getOne();
    if (!collection) {
      throw AppException.notFound("Collection");
    }
    if (collection.type !== "manual") {
      throw AppException.conflict("COLLECTION_NOT_MANUAL", "Products can only be edited on manual collections; smart collections are rule-based");
    }
    return collection;
  }

  private async memberIds(manager: EntityManager, collectionId: string): Promise<string[]> {
    const rows: { product_id: string }[] = await manager.query(
      "SELECT product_id FROM collection_products WHERE collection_id = $1 ORDER BY position ASC, id ASC",
      [collectionId],
    );
    return rows.map((r) => r.product_id);
  }

  /** Rewrite positions as 0..n-1 following `ordered` (one statement). */
  private async writePositions(manager: EntityManager, collectionId: string, ordered: string[]): Promise<void> {
    if (ordered.length === 0) return;
    await manager.query(
      `UPDATE collection_products cp SET position = v.pos
       FROM unnest($1::uuid[], $2::int[]) AS v(product_id, pos)
       WHERE cp.collection_id = $3 AND cp.product_id = v.product_id AND cp.position IS DISTINCT FROM v.pos`,
      [ordered, ordered.map((_, i) => i), collectionId],
    );
  }

  async previewRules(input: PreviewRulesInput, limit: number = 24): Promise<PreviewRulesResponseDto> {
    const params = new SqlParams();
    const condition = buildSmartRulesCondition(input.rules, params);
    const where = `p.status = 'active' AND p.deleted_at IS NULL AND ${condition}`;

    const countRows: { total: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM products p WHERE ${where}`,
      params.values,
    );
    const total = countRows[0]?.total ?? 0;

    const limitPh = params.push(limit);
    const rows: PreviewRow[] = await this.dataSource.query(
      `SELECT p.id, p.handle, p.title, pr.min_price, m.url, m.alt, m.width, m.height
       FROM products p
       LEFT JOIN LATERAL (
         SELECT MIN(v.price) AS min_price FROM variants v WHERE v.product_id = p.id AND v.is_active = true
       ) pr ON true
       LEFT JOIN LATERAL (
         SELECT md.url, md.alt, md.width, md.height
         FROM product_media pm JOIN media md ON md.id = pm.media_id
         WHERE pm.product_id = p.id
         ORDER BY pm.position ASC, pm.id ASC LIMIT 1
       ) m ON true
       WHERE ${where}
       ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id ASC
       LIMIT ${limitPh}`,
      params.values,
    );

    return {
      products: rows.map((r) => ({
        id: r.id,
        handle: r.handle,
        title: r.title,
        price: r.min_price === null ? 0 : Number(r.min_price),
        image: r.url ? { url: r.url, alt: r.alt ?? null, width: r.width ?? null, height: r.height ?? null } : null,
      })),
      total,
    };
  }

  private mapToDto(collection: Collection): CollectionDto {
    return {
      id: collection.id,
      handle: collection.handle,
      title: collection.title,
      descriptionHtml: collection.descriptionHtml,
      type: collection.type as "manual" | "smart",
      rules: collection.rules,
      sortOrder: collection.sortOrder as "manual" | "title" | "newest" | "price_asc" | "price_desc",
      isPublished: collection.isPublished,
      seoTitle: collection.seoTitle ?? null,
      seoDescription: collection.seoDescription ?? null,
      imageMediaId: collection.imageMediaId ?? null,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    };
  }

  private async saveUnique(repo: Repository<Collection>, collection: Collection, handle: string): Promise<Collection> {
    try {
      return await repo.save(collection);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppException.conflict("HANDLE_TAKEN", `Collection with handle "${handle}" already exists`);
      }
      throw err;
    }
  }
}
