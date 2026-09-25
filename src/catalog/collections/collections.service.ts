import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, QueryFailedError, Repository } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { Collection, CollectionProduct, Product } from "../../catalog/entities";
import { AppException } from "../../common/errors/app-exception";
import { SqlParams } from "../../common/sql/sql-params";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import {
  CollectionCreateInput,
  CollectionUpdateInput,
  CollectionProductsUpdateInput,
  CollectionDto,
  PreviewRulesInput,
  PreviewRulesResponseDto,
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
      collection.descriptionHtml = input.descriptionHtml ?? "";
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

      if (input.handle !== undefined && input.handle !== collection.handle) {
        diff.handle = { old: collection.handle, new: input.handle };
        collection.handle = input.handle;
      }
      if (input.title !== undefined && input.title !== collection.title) {
        diff.title = { old: collection.title, new: input.title };
        collection.title = input.title;
      }
      if (input.descriptionHtml !== undefined && input.descriptionHtml !== collection.descriptionHtml) {
        diff.descriptionHtml = { old: collection.descriptionHtml, new: input.descriptionHtml };
        collection.descriptionHtml = input.descriptionHtml;
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
    });
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
