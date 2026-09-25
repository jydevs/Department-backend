import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, EntityManager, In } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { sanitizeRichText } from "../../common/html/sanitize";
import { Product, Variant, ProductOption, ProductOptionValue, ProductMedia, Media, CollectionProduct } from "../entities";
import { AppException } from "../../common/errors/app-exception";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { Clock } from "../../common/clock/clock";
import { escapeLike } from "../../common/sql/escape-like";
import {
  ProductCreateInput,
  ProductUpdateInput,
  VariantCreateInput,
  VariantUpdateInput,
  ProductDetailResponseDto,
  ProductListItemResponseDto,
  VariantResponseDto,
  OptionsUpdateInput,
  MediaUpdateInput,
  BulkActionInput,
} from "./dto";
import { toOffsetPage, OffsetPage } from "../../common/pagination/pagination";

interface OptionWithValues {
  id: string;
  name: string;
  position: number;
  values: Array<{ id: string; value: string; position: number; createdAt?: Date }>;
}

interface MediaItem {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
}

export interface BulkActionResult {
  action: string;
  processed: string[];
  skipped: Array<{ id: string; reason: string }>;
}

const MAX_VARIANTS = 100;
const HANDLE_ATTEMPTS = 5;

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
    private readonly clock: Clock,
  ) {}

  /* ───────────── create ───────────── */

  async create(input: ProductCreateInput): Promise<ProductDetailResponseDto> {
    // Validate everything that needs no DB BEFORE opening the transaction / generating anything.
    this.assertUnique(input.tags ?? [], "Duplicate tags");
    if (input.options && input.options.length > 0) {
      this.validateOptionsInput(input.options);
      if (!input.variants || input.variants.length === 0) {
        const size = input.options.reduce((acc, o) => acc * o.values.length, 1);
        if (size > MAX_VARIANTS) {
          throw AppException.badRequest("BAD_REQUEST", `Generated variant combinations (${size}) exceed ${MAX_VARIANTS}`);
        }
      }
    }
    for (const v of input.variants ?? []) this.assertPrices(v.price, v.compareAtPrice);
    const skus = (input.variants ?? []).map((v) => v.sku).filter((s): s is string => !!s);
    this.assertUnique(skus, "Duplicate SKUs in variants", "SKU_TAKEN");

    return this.transactionService.run(async (manager) => {
      const optionRepo = manager.getRepository(ProductOption);
      const optionValueRepo = manager.getRepository(ProductOptionValue);

      const product = new Product();
      product.id = uuidv7();
      product.title = input.title;
      product.descriptionHtml = sanitizeRichText(input.descriptionHtml || "");
      product.status = "draft"; // publication only through /publish
      product.vendor = input.vendor ?? null;
      product.productType = input.productType ?? null;
      product.tags = input.tags || [];
      product.seoTitle = input.seoTitle ?? null;
      product.seoDescription = input.seoDescription ?? null;

      const savedProduct = await this.insertWithUniqueHandle(input.handle || this.slugify(input.title), product, manager);

      const optionsList: OptionWithValues[] = [];
      for (let optIdx = 0; optIdx < (input.options ?? []).length; optIdx++) {
        const optInput = input.options![optIdx];
        const option = new ProductOption();
        option.id = uuidv7();
        option.productId = savedProduct.id;
        option.name = optInput.name;
        option.position = optIdx;
        const savedOption = await optionRepo.save(option);

        const valuesList: OptionWithValues["values"] = [];
        for (let valIdx = 0; valIdx < optInput.values.length; valIdx++) {
          const value = new ProductOptionValue();
          value.id = uuidv7();
          value.optionId = savedOption.id;
          value.value = optInput.values[valIdx].value;
          value.position = valIdx;
          const savedValue = await optionValueRepo.save(value);
          valuesList.push({ id: savedValue.id, value: savedValue.value, position: savedValue.position, createdAt: savedValue.createdAt });
        }
        optionsList.push({ id: savedOption.id, name: savedOption.name, position: savedOption.position, values: valuesList });
      }

      if (input.variants && input.variants.length > 0) {
        await this.createVariantsWithSkuCheck(input.variants, savedProduct.id, manager);
      } else if (optionsList.length > 0) {
        await this.generateCartesianVariants(optionsList, savedProduct.id, manager);
      }

      await this.auditService.record(
        {
          action: "product:create",
          entityType: "Product",
          entityId: savedProduct.id,
          diff: { title: input.title, handle: savedProduct.handle, status: "draft" },
        },
        manager,
      );

      return (await this.findById(savedProduct.id, manager)) as ProductDetailResponseDto;
    });
  }

  /* ───────────── read ───────────── */

  /** Pass `manager` when calling inside a transaction so the read sees uncommitted state and uses the same connection. */
  async findById(id: string, manager?: EntityManager): Promise<ProductDetailResponseDto | null> {
    const m = manager ?? this.productRepository.manager;
    const product = await m.getRepository(Product).findOne({ where: { id } });
    if (!product) return null;

    const options = await m.getRepository(ProductOption).find({ where: { productId: id }, order: { position: "ASC" } });
    const values =
      options.length > 0
        ? await m.getRepository(ProductOptionValue).find({ where: { optionId: In(options.map((o) => o.id)) }, order: { position: "ASC" } })
        : [];
    const variants = await m.getRepository(Variant).find({ where: { productId: id }, order: { position: "ASC" } });
    const productMedia = await m.getRepository(ProductMedia).find({ where: { productId: id }, order: { position: "ASC" } });
    const mediaRows =
      productMedia.length > 0 ? await m.getRepository(Media).find({ where: { id: In(productMedia.map((pm) => pm.mediaId)) } }) : [];
    const mediaById = new Map(mediaRows.map((r) => [r.id, r]));

    const optionsWithValues: OptionWithValues[] = options.map((opt) => ({
      id: opt.id,
      name: opt.name,
      position: opt.position,
      values: values
        .filter((v) => v.optionId === opt.id)
        .map((v) => ({ id: v.id, value: v.value, position: v.position, createdAt: v.createdAt })),
    }));

    const mediaList: MediaItem[] = [];
    for (const pm of productMedia) {
      const r = mediaById.get(pm.mediaId);
      if (r) {
        mediaList.push({
          id: r.id,
          url: r.url,
          alt: r.alt ?? null,
          width: r.width ?? null,
          height: r.height ?? null,
          mimeType: r.mimeType ?? null,
        });
      }
    }

    return this.mapToDetailDto(product, optionsWithValues, variants, mediaList);
  }

  async list(
    page: number,
    pageSize: number,
    filters: { status?: string; q?: string; tag?: string; vendor?: string },
  ): Promise<OffsetPage<ProductListItemResponseDto>> {
    const qb = this.productRepository.createQueryBuilder("p");

    if (filters.status) qb.andWhere("p.status = :status", { status: filters.status });

    if (filters.q) {
      const pattern = `%${escapeLike(filters.q)}%`;
      qb.andWhere(
        "(p.title ILIKE :q ESCAPE '\\' OR p.handle ILIKE :q ESCAPE '\\' OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.sku ILIKE :q ESCAPE '\\'))",
        { q: pattern },
      );
    }
    if (filters.tag) qb.andWhere(":tag = ANY(p.tags)", { tag: filters.tag });
    if (filters.vendor) qb.andWhere("p.vendor = :vendor", { vendor: filters.vendor });

    const [items, total] = await qb
      .orderBy("p.created_at", "DESC")
      .addOrderBy("p.id", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    if (items.length === 0) return toOffsetPage([], total, page, pageSize);

    const ids = items.map((i) => i.id);
    const manager = this.productRepository.manager;

    // One aggregate query for the whole page (active variants only; on_hand summed per variant first to avoid join fan-out).
    const aggRows: Array<{ productId: string; variantCount: number; minPrice: string | null; maxPrice: string | null; inventoryTotal: string | null }> =
      await manager.query(
        `SELECT v.product_id AS "productId",
                COUNT(*)::int AS "variantCount",
                MIN(v.price) AS "minPrice",
                MAX(v.price) AS "maxPrice",
                COALESCE(SUM(inv.on_hand), 0) AS "inventoryTotal"
           FROM variants v
           LEFT JOIN (
             SELECT il.variant_id, SUM(il.on_hand) AS on_hand
               FROM inventory_levels il
              WHERE il.variant_id IN (SELECT id FROM variants WHERE product_id = ANY($1::uuid[]))
              GROUP BY il.variant_id
           ) inv ON inv.variant_id = v.id
          WHERE v.product_id = ANY($1::uuid[]) AND v.is_active = true
          GROUP BY v.product_id`,
        [ids],
      );
    const aggById = new Map(aggRows.map((r) => [r.productId, r]));

    // One query for the primary (lowest position) image of each product.
    const imageRows: Array<{ productId: string; id: string; url: string; alt: string | null; width: number | null; height: number | null; mimeType: string | null }> =
      await manager.query(
        `SELECT DISTINCT ON (pm.product_id)
                pm.product_id AS "productId", m.id, m.url, m.alt, m.width, m.height, m.mime_type AS "mimeType"
           FROM product_media pm
           JOIN media m ON m.id = pm.media_id
          WHERE pm.product_id = ANY($1::uuid[])
          ORDER BY pm.product_id, pm.position ASC`,
        [ids],
      );
    const imageById = new Map(imageRows.map((r) => [r.productId, r]));

    const result: ProductListItemResponseDto[] = items.map((item) => {
      const agg = aggById.get(item.id);
      const img = imageById.get(item.id);
      return {
        id: item.id,
        handle: item.handle,
        title: item.title,
        status: item.status as "draft" | "active" | "archived",
        variantCount: agg ? Number(agg.variantCount) : 0,
        inventoryTotal: agg ? Number(agg.inventoryTotal ?? 0) : 0,
        minPrice: agg && agg.minPrice !== null ? Number(agg.minPrice) : null,
        maxPrice: agg && agg.maxPrice !== null ? Number(agg.maxPrice) : null,
        primaryImage: img
          ? { id: img.id, url: img.url, alt: img.alt ?? null, width: img.width ?? null, height: img.height ?? null, mimeType: img.mimeType ?? null }
          : null,
      };
    });

    return toOffsetPage(result, total, page, pageSize);
  }

  /* ───────────── update / delete product ───────────── */

  async update(id: string, input: ProductUpdateInput): Promise<ProductDetailResponseDto> {
    if (input.tags !== undefined) this.assertUnique(input.tags, "Duplicate tags");

    return this.transactionService.run(async (manager) => {
      const product = await manager.getRepository(Product).findOne({ where: { id } });
      if (!product) throw AppException.notFound("Product");

      // Early exit only; the real guard is the conditional UPDATE below.
      if (product.version !== input.version) {
        throw AppException.conflict("CONCURRENT_UPDATE", "The product was modified concurrently");
      }

      const diff: Record<string, unknown> = {};
      const set: Partial<Product> = {};

      if (input.title !== undefined && input.title !== product.title) {
        diff.title = { old: product.title, new: input.title };
        set.title = input.title;
      }
      const cleanDescription = input.descriptionHtml !== undefined ? sanitizeRichText(input.descriptionHtml) : undefined;
      if (cleanDescription !== undefined && cleanDescription !== product.descriptionHtml) {
        diff.descriptionHtml = { old: product.descriptionHtml, new: cleanDescription };
        set.descriptionHtml = cleanDescription;
      }
      if (input.handle !== undefined && input.handle !== product.handle) {
        const taken = await manager.getRepository(Product).findOne({ where: { handle: input.handle }, withDeleted: true });
        if (taken && taken.id !== id) throw AppException.conflict("CONFLICT", "This handle is already in use");
        diff.handle = { old: product.handle, new: input.handle };
        set.handle = input.handle;
      }
      if (input.vendor !== undefined && input.vendor !== product.vendor) {
        diff.vendor = { old: product.vendor, new: input.vendor };
        set.vendor = input.vendor ?? null;
      }
      if (input.productType !== undefined && input.productType !== product.productType) {
        diff.productType = { old: product.productType, new: input.productType };
        set.productType = input.productType ?? null;
      }
      if (input.tags !== undefined && JSON.stringify(input.tags) !== JSON.stringify(product.tags)) {
        diff.tags = { old: product.tags, new: input.tags };
        set.tags = input.tags;
      }
      if (input.seoTitle !== undefined && input.seoTitle !== product.seoTitle) {
        diff.seoTitle = { old: product.seoTitle, new: input.seoTitle };
        set.seoTitle = input.seoTitle ?? null;
      }
      if (input.seoDescription !== undefined && input.seoDescription !== product.seoDescription) {
        diff.seoDescription = { old: product.seoDescription, new: input.seoDescription };
        set.seoDescription = input.seoDescription ?? null;
      }

      if (Object.keys(diff).length > 0) {
        let affected: number | undefined;
        try {
          // Real optimistic lock: the version check and the bump are one atomic statement.
          const res = await manager.transaction((m) =>
            m
              .createQueryBuilder()
              .update(Product)
              .set({ ...set, version: () => "version + 1" })
              .where("id = :id AND version = :version", { id, version: input.version })
              .execute(),
          );
          affected = res.affected;
        } catch (err) {
          if (this.isDuplicateKeyError(err)) throw AppException.conflict("CONFLICT", "This handle is already in use");
          throw err;
        }
        if (!affected) throw AppException.conflict("CONCURRENT_UPDATE", "The product was modified concurrently");

        await this.auditService.record({ action: "product:update", entityType: "Product", entityId: id, diff }, manager);
      }

      return (await this.findById(id, manager)) as ProductDetailResponseDto;
    });
  }

  async delete(id: string): Promise<void> {
    return this.transactionService.run(async (manager) => {
      const product = await manager.getRepository(Product).findOne({ where: { id } });
      if (!product) throw AppException.notFound("Product");

      await this.softDeleteProducts([id], manager);

      await this.auditService.record(
        { action: "product:delete", entityType: "Product", entityId: id, diff: { status: { old: product.status } } },
        manager,
      );
    });
  }

  /** Soft delete + release SKUs + deactivate variants + drop collection membership, all on the caller's transaction. */
  private async softDeleteProducts(ids: string[], manager: EntityManager): Promise<void> {
    if (ids.length === 0) return;
    await manager.getRepository(Product).update({ id: In(ids) }, { deletedAt: this.clock.now() });
    await manager
      .createQueryBuilder()
      .update(Variant)
      .set({ sku: null, isActive: false, version: () => "version + 1" })
      .where("product_id IN (:...ids)", { ids })
      .execute();
    await manager.getRepository(CollectionProduct).delete({ productId: In(ids) });
  }

  /* ───────────── variants ───────────── */

  async createVariant(productId: string, input: VariantCreateInput): Promise<VariantResponseDto> {
    this.assertPrices(input.price, input.compareAtPrice);

    return this.transactionService.run(async (manager) => {
      const variantRepo = manager.getRepository(Variant);

      const product = await manager.getRepository(Product).findOne({ where: { id: productId } });
      if (!product) throw AppException.notFound("Product");

      const variant = new Variant();
      variant.id = uuidv7();
      variant.productId = productId;
      variant.sku = input.sku ?? null;
      variant.title = input.title;
      variant.price = input.price;
      variant.compareAtPrice = input.compareAtPrice ?? null;
      variant.weightGrams = input.weightGrams ?? null;
      variant.barcode = input.barcode ?? null;
      variant.trackInventory = input.trackInventory !== undefined ? input.trackInventory : true;
      variant.allowBackorder = input.allowBackorder !== undefined ? input.allowBackorder : false;
      variant.optionValueIds = input.optionValueIds || [];
      variant.isActive = input.isActive !== undefined ? input.isActive : true;

      const max = await variantRepo
        .createQueryBuilder("v")
        .select("COALESCE(MAX(v.position), -1)", "max")
        .where("v.product_id = :productId", { productId })
        .getRawOne<{ max: string | number }>();
      variant.position = Number(max?.max ?? -1) + 1;

      try {
        const saved = await variantRepo.save(variant);
        await this.auditService.record(
          {
            action: "product:variant:create",
            entityType: "Variant",
            entityId: saved.id,
            diff: { productId, sku: input.sku ?? null, title: input.title },
          },
          manager,
        );
        return this.mapVariantToDto(saved);
      } catch (err: unknown) {
        if (this.isDuplicateKeyError(err) && input.sku) throw AppException.conflict("SKU_TAKEN", "This SKU is already in use");
        throw err;
      }
    });
  }

  async updateVariant(productId: string, variantId: string, input: VariantUpdateInput): Promise<VariantResponseDto> {
    return this.transactionService.run(async (manager) => {
      const variantRepo = manager.getRepository(Variant);

      const variant = await variantRepo.findOne({ where: { id: variantId, productId } });
      if (!variant) throw AppException.notFound("Variant");

      if (variant.version !== input.version) {
        throw AppException.conflict("CONCURRENT_UPDATE", "The variant was modified concurrently");
      }

      const diff: Record<string, unknown> = {};
      const set: Partial<Variant> = {};

      if (input.sku !== undefined && input.sku !== variant.sku) {
        diff.sku = { old: variant.sku, new: input.sku };
        set.sku = input.sku ?? null;
      }
      if (input.title !== undefined && input.title !== variant.title) {
        diff.title = { old: variant.title, new: input.title };
        set.title = input.title;
      }
      if (input.price !== undefined && input.price !== variant.price) {
        diff.price = { old: variant.price, new: input.price };
        set.price = input.price;
      }
      if (input.compareAtPrice !== undefined && input.compareAtPrice !== variant.compareAtPrice) {
        diff.compareAtPrice = { old: variant.compareAtPrice, new: input.compareAtPrice };
        set.compareAtPrice = input.compareAtPrice ?? null;
      }
      if (input.weightGrams !== undefined && input.weightGrams !== variant.weightGrams) {
        diff.weightGrams = { old: variant.weightGrams, new: input.weightGrams };
        set.weightGrams = input.weightGrams ?? null;
      }
      if (input.barcode !== undefined && input.barcode !== variant.barcode) {
        diff.barcode = { old: variant.barcode, new: input.barcode };
        set.barcode = input.barcode ?? null;
      }
      if (
        (input.trackInventory !== undefined && input.trackInventory !== variant.trackInventory) ||
        (input.allowBackorder !== undefined && input.allowBackorder !== variant.allowBackorder)
      ) {
        // reservations were made under the old policy; release/commit would skip or over-take them
        // SUM cannot be combined with FOR UPDATE: lock the level rows in a subquery so concurrent reserves wait.
        const [held] = await manager.query<{ reserved: string }[]>(
          `SELECT COALESCE(SUM(t.reserved), 0)::bigint AS reserved
           FROM (SELECT reserved FROM inventory_levels WHERE variant_id = $1 FOR UPDATE) t`,
          [variant.id],
        );
        // pending orders hold (or may hold) reservations of this variant even if the level sum is momentarily 0
        const [pending] = await manager.query<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM order_lines ol JOIN orders o ON o.id = ol.order_id
           WHERE o.status = 'pending' AND ol.variant_id = $1`,
          [variant.id],
        );
        if (Number(held?.reserved ?? 0) > 0 || (pending?.n ?? 0) > 0) {
          throw AppException.conflict("INVENTORY_POLICY_LOCKED", "Stock is reserved for this variant; change the inventory policy after those orders are settled");
        }
      }
      if (input.trackInventory !== undefined && input.trackInventory !== variant.trackInventory) {
        diff.trackInventory = { old: variant.trackInventory, new: input.trackInventory };
        set.trackInventory = input.trackInventory;
      }
      if (input.allowBackorder !== undefined && input.allowBackorder !== variant.allowBackorder) {
        diff.allowBackorder = { old: variant.allowBackorder, new: input.allowBackorder };
        set.allowBackorder = input.allowBackorder;
      }
      if (input.optionValueIds !== undefined && JSON.stringify(input.optionValueIds) !== JSON.stringify(variant.optionValueIds)) {
        diff.optionValueIds = { old: variant.optionValueIds, new: input.optionValueIds };
        set.optionValueIds = input.optionValueIds;
      }
      if (input.isActive !== undefined && input.isActive !== variant.isActive) {
        diff.isActive = { old: variant.isActive, new: input.isActive };
        set.isActive = input.isActive;
        if (!input.isActive) await this.assertNotLastActiveVariant(variant, manager);
      }

      // compareAtPrice >= price, judged on the resulting values.
      this.assertPrices(set.price ?? variant.price, set.compareAtPrice !== undefined ? set.compareAtPrice : variant.compareAtPrice);

      if (Object.keys(diff).length > 0) {
        let affected: number | undefined;
        try {
          const res = await manager.transaction((m) =>
            m
              .createQueryBuilder()
              .update(Variant)
              .set({ ...set, version: () => "version + 1" })
              .where("id = :id AND version = :version", { id: variantId, version: input.version })
              .execute(),
          );
          affected = res.affected;
        } catch (err: unknown) {
          if (this.isDuplicateKeyError(err) && input.sku) throw AppException.conflict("SKU_TAKEN", "This SKU is already in use");
          throw err;
        }
        if (!affected) throw AppException.conflict("CONCURRENT_UPDATE", "The variant was modified concurrently");

        await this.auditService.record(
          { action: "product:variant:update", entityType: "Variant", entityId: variantId, diff },
          manager,
        );
      }

      const updated = await variantRepo.findOneOrFail({ where: { id: variantId } });
      return this.mapVariantToDto(updated);
    });
  }

  /**
   * Logical delete on purpose. A physical DELETE would cascade to inventory_levels (FK ON DELETE CASCADE)
   * and leave inventory_adjustments pointing at a variant that no longer exists, destroying stock history.
   * So we deactivate the variant and null its SKU (the partial unique index only covers non-null SKUs,
   * which frees the code for reuse). The last active variant of an active product cannot be removed.
   */
  async deleteVariant(productId: string, variantId: string): Promise<void> {
    return this.transactionService.run(async (manager) => {
      const variant = await manager.getRepository(Variant).findOne({ where: { id: variantId, productId } });
      if (!variant) throw AppException.notFound("Variant");

      await this.assertNotLastActiveVariant(variant, manager);

      await manager
        .createQueryBuilder()
        .update(Variant)
        .set({ isActive: false, sku: null, version: () => "version + 1" })
        .where("id = :id", { id: variantId })
        .execute();

      await this.auditService.record(
        {
          action: "product:variant:delete",
          entityType: "Variant",
          entityId: variantId,
          diff: { productId, sku: { old: variant.sku ?? null, new: null }, isActive: { old: variant.isActive, new: false } },
        },
        manager,
      );
    });
  }

  private async assertNotLastActiveVariant(variant: Variant, manager: EntityManager): Promise<void> {
    if (!variant.isActive) return;
    const product = await manager.getRepository(Product).findOne({ where: { id: variant.productId } });
    if (!product || product.status !== "active") return;
    const otherActive = await manager
      .getRepository(Variant)
      .createQueryBuilder("v")
      .where("v.product_id = :pid AND v.is_active = true AND v.id <> :vid", { pid: variant.productId, vid: variant.id })
      .getCount();
    if (otherActive === 0) {
      throw AppException.conflict("CONFLICT", "Cannot remove or deactivate the last active variant of an active product");
    }
  }

  /* ───────────── helpers: handles, validation ───────────── */

  /**
   * Inserts the product trying `base`, `base-2`, ... A concurrent insert may win the race between our
   * existence check and the INSERT: the unique violation (23505) is caught inside a SAVEPOINT (nested
   * transaction, otherwise Postgres would abort the whole outer transaction) and the next suffix is tried.
   */
  private async insertWithUniqueHandle(base: string, product: Product, manager: EntityManager): Promise<Product> {
    const root = base.toLowerCase().slice(0, 110).replace(/-+$/g, "") || "producto";
    let attempts = 0;
    for (let suffix = 1; suffix <= 50 && attempts < HANDLE_ATTEMPTS; suffix++) {
      const candidate = suffix === 1 ? root : `${root}-${suffix}`;
      const exists = await manager.getRepository(Product).findOne({ where: { handle: candidate }, withDeleted: true, select: { id: true } });
      if (exists) continue;
      attempts++;
      try {
        product.handle = candidate;
        return await manager.transaction((m) => m.getRepository(Product).save(product));
      } catch (err) {
        if (this.isDuplicateKeyError(err)) continue;
        throw err;
      }
    }
    throw AppException.conflict("CONFLICT", "Could not allocate a unique handle, please retry or provide another handle");
  }

  private slugify(text: string): string {
    const slug = text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "producto";
  }

  private assertUnique(values: string[], message: string, code: string = "BAD_REQUEST"): void {
    const seen = new Set<string>();
    for (const v of values) {
      if (seen.has(v)) {
        if (code === "SKU_TAKEN") throw AppException.conflict("SKU_TAKEN", `${message}: ${v}`);
        throw AppException.badRequest("BAD_REQUEST", `${message}: ${v}`);
      }
      seen.add(v);
    }
  }

  private assertPrices(price: number, compareAtPrice: number | null | undefined): void {
    if (compareAtPrice !== null && compareAtPrice !== undefined && compareAtPrice < price) {
      throw AppException.badRequest("BAD_REQUEST", "compareAtPrice must be greater than or equal to price");
    }
  }

  private validateOptionsInput(options: Array<{ name: string; values: Array<{ value: string }> }>): void {
    if (options.length > 3) throw AppException.badRequest("BAD_REQUEST", "A product can have at most 3 options");
    const names = new Set<string>();
    for (const opt of options) {
      const key = opt.name.trim().toLowerCase();
      if (names.has(key)) throw AppException.badRequest("BAD_REQUEST", `Duplicate option name: ${opt.name}`);
      names.add(key);
      if (opt.values.length > 100) throw AppException.badRequest("BAD_REQUEST", `Option ${opt.name} has more than 100 values`);
      const vals = new Set<string>();
      for (const v of opt.values) {
        const vk = v.value.trim().toLowerCase();
        if (vals.has(vk)) throw AppException.badRequest("BAD_REQUEST", `Duplicate value "${v.value}" in option ${opt.name}`);
        vals.add(vk);
      }
    }
  }

  private async createVariantsWithSkuCheck(variants: VariantCreateInput[], productId: string, manager: EntityManager): Promise<Variant[]> {
    const variantRepo = manager.getRepository(Variant);
    const result: Variant[] = [];

    for (let i = 0; i < variants.length; i++) {
      const input = variants[i];
      const variant = new Variant();
      variant.id = uuidv7();
      variant.productId = productId;
      variant.sku = input.sku ?? null;
      variant.title = input.title;
      variant.price = input.price;
      variant.compareAtPrice = input.compareAtPrice ?? null;
      variant.weightGrams = input.weightGrams ?? null;
      variant.barcode = input.barcode ?? null;
      variant.position = i;
      variant.trackInventory = input.trackInventory !== undefined ? input.trackInventory : true;
      variant.allowBackorder = input.allowBackorder !== undefined ? input.allowBackorder : false;
      variant.optionValueIds = input.optionValueIds || [];
      variant.isActive = input.isActive !== undefined ? input.isActive : true;

      try {
        result.push(await variantRepo.save(variant));
      } catch (err: unknown) {
        if (this.isDuplicateKeyError(err) && input.sku) throw AppException.conflict("SKU_TAKEN", "This SKU is already in use");
        throw err;
      }
    }
    return result;
  }

  private async generateCartesianVariants(options: OptionWithValues[], productId: string, manager: EntityManager): Promise<Variant[]> {
    const variantRepo = manager.getRepository(Variant);

    // Size is computed from lengths BEFORE materialising anything.
    const size = options.reduce((acc, o) => acc * o.values.length, 1);
    if (size > MAX_VARIANTS) {
      throw AppException.badRequest("BAD_REQUEST", `Generated variant combinations (${size}) exceed ${MAX_VARIANTS}`);
    }

    const labelById = new Map(options.flatMap((o) => o.values).map((v) => [v.id, v.value]));
    const combinations = this.cartesianProduct(options.map((opt) => opt.values.map((v) => v.id)));

    const variants: Variant[] = [];
    for (let i = 0; i < combinations.length; i++) {
      const variant = new Variant();
      variant.id = uuidv7();
      variant.productId = productId;
      variant.sku = null;
      variant.title = combinations[i].map((valueId) => labelById.get(valueId) ?? "").join(" / ");
      variant.price = 0;
      variant.position = i;
      variant.optionValueIds = combinations[i];
      variant.isActive = true;
      variants.push(await variantRepo.save(variant));
    }
    return variants;
  }

  private cartesianProduct<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restProduct = this.cartesianProduct(rest);
    return first.flatMap((v) => restProduct.map((r) => [v, ...r]));
  }

  private mapVariantToDto(variant: Variant): VariantResponseDto {
    return {
      id: variant.id,
      productId: variant.productId,
      sku: variant.sku ?? null,
      title: variant.title,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice ?? null,
      weightGrams: variant.weightGrams ?? null,
      barcode: variant.barcode ?? null,
      position: variant.position,
      trackInventory: variant.trackInventory,
      allowBackorder: variant.allowBackorder,
      optionValueIds: variant.optionValueIds,
      isActive: variant.isActive,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
      version: variant.version,
    };
  }

  private mapToDetailDto(product: Product, options: OptionWithValues[], variants: Variant[], media: MediaItem[]): ProductDetailResponseDto {
    return {
      id: product.id,
      handle: product.handle,
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      status: product.status as "draft" | "active" | "archived",
      vendor: product.vendor ?? null,
      productType: product.productType ?? null,
      tags: product.tags,
      seoTitle: product.seoTitle ?? null,
      seoDescription: product.seoDescription ?? null,
      publishedAt: product.publishedAt ?? null,
      options: options.map((o) => ({
        id: o.id,
        name: o.name,
        position: o.position,
        values: o.values.map((v) => ({ id: v.id, value: v.value, position: v.position, createdAt: v.createdAt ?? this.clock.now() })),
      })),
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku ?? null,
        title: v.title,
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? null,
        weightGrams: v.weightGrams ?? null,
        barcode: v.barcode ?? null,
        position: v.position,
        trackInventory: v.trackInventory,
        allowBackorder: v.allowBackorder,
        optionValueIds: v.optionValueIds,
        isActive: v.isActive,
      })),
      media: media.map((m) => ({ id: m.id, url: m.url, alt: m.alt ?? null, width: m.width ?? null, height: m.height ?? null, mimeType: m.mimeType ?? null })),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      version: product.version,
    };
  }

  /* ───────────── duplicate / publish / archive ───────────── */

  async duplicate(id: string): Promise<ProductDetailResponseDto> {
    return this.transactionService.run(async (manager) => {
      const productRepo = manager.getRepository(Product);
      const variantRepo = manager.getRepository(Variant);
      const optionRepo = manager.getRepository(ProductOption);
      const optionValueRepo = manager.getRepository(ProductOptionValue);
      const mediaRepo = manager.getRepository(ProductMedia);

      const product = await productRepo.findOne({ where: { id } });
      if (!product) throw AppException.notFound("Product");

      const newProduct = new Product();
      newProduct.id = uuidv7();
      newProduct.title = product.title;
      newProduct.descriptionHtml = product.descriptionHtml;
      newProduct.status = "draft";
      newProduct.vendor = product.vendor;
      newProduct.productType = product.productType;
      newProduct.tags = [...product.tags];
      newProduct.seoTitle = product.seoTitle;
      newProduct.seoDescription = product.seoDescription;

      const savedProduct = await this.insertWithUniqueHandle(product.handle, newProduct, manager);

      const options = await optionRepo.find({ where: { productId: id }, order: { position: "ASC" } });
      const valueIdMap = new Map<string, string>();

      for (const opt of options) {
        const newOption = new ProductOption();
        newOption.id = uuidv7();
        newOption.productId = savedProduct.id;
        newOption.name = opt.name;
        newOption.position = opt.position;
        const savedOption = await optionRepo.save(newOption);

        const values = await optionValueRepo.find({ where: { optionId: opt.id }, order: { position: "ASC" } });
        for (const val of values) {
          const newValue = new ProductOptionValue();
          newValue.id = uuidv7();
          newValue.optionId = savedOption.id;
          newValue.value = val.value;
          newValue.position = val.position;
          const savedValue = await optionValueRepo.save(newValue);
          valueIdMap.set(val.id, savedValue.id);
        }
      }

      const variants = await variantRepo.find({ where: { productId: id }, order: { position: "ASC" } });
      const variantIdMap = new Map<string, string>();

      for (const variant of variants) {
        const newVariant = new Variant();
        newVariant.id = uuidv7();
        newVariant.productId = savedProduct.id;
        newVariant.sku = null; // SKUs are unique globally; the copy must not steal or collide with the original's
        newVariant.title = variant.title;
        newVariant.price = variant.price;
        newVariant.compareAtPrice = variant.compareAtPrice;
        newVariant.weightGrams = variant.weightGrams;
        newVariant.barcode = variant.barcode;
        newVariant.position = variant.position;
        newVariant.trackInventory = variant.trackInventory;
        newVariant.allowBackorder = variant.allowBackorder;
        newVariant.optionValueIds = variant.optionValueIds.map((vid) => valueIdMap.get(vid)).filter((v): v is string => !!v);
        newVariant.isActive = variant.isActive;
        await variantRepo.save(newVariant);
        variantIdMap.set(variant.id, newVariant.id);
      }

      const media = await mediaRepo.find({ where: { productId: id }, order: { position: "ASC" } });
      for (const pm of media) {
        const newProductMedia = new ProductMedia();
        newProductMedia.id = uuidv7();
        newProductMedia.productId = savedProduct.id;
        newProductMedia.mediaId = pm.mediaId;
        newProductMedia.variantId = pm.variantId ? (variantIdMap.get(pm.variantId) ?? null) : null;
        newProductMedia.position = pm.position;
        await mediaRepo.save(newProductMedia);
      }

      await this.auditService.record(
        {
          action: "product:duplicate",
          entityType: "Product",
          entityId: savedProduct.id,
          diff: { sourceId: id, handle: savedProduct.handle },
        },
        manager,
      );

      return (await this.findById(savedProduct.id, manager)) as ProductDetailResponseDto;
    });
  }

  private async hasPublishableVariant(productId: string, manager: EntityManager): Promise<boolean> {
    const n = await manager
      .getRepository(Variant)
      .createQueryBuilder("v")
      .where("v.product_id = :productId AND v.is_active = true AND v.price > 0", { productId })
      .getCount();
    return n > 0;
  }

  async publish(id: string): Promise<ProductDetailResponseDto> {
    return this.transactionService.run(async (manager) => {
      const productRepo = manager.getRepository(Product);

      const product = await productRepo.findOne({ where: { id } });
      if (!product) throw AppException.notFound("Product");

      if (!(await this.hasPublishableVariant(id, manager))) {
        throw AppException.badRequest("BAD_REQUEST", "Product must have at least one active variant with a price > 0");
      }

      const old = { status: product.status, publishedAt: product.publishedAt ?? null }; // captured BEFORE mutating
      const publishedAt = product.status === "active" && product.publishedAt ? product.publishedAt : this.clock.now();

      await productRepo.update({ id }, { status: "active", publishedAt });

      await this.auditService.record(
        {
          action: "product:publish",
          entityType: "Product",
          entityId: id,
          diff: { status: { old: old.status, new: "active" }, publishedAt: { old: old.publishedAt, new: publishedAt } },
        },
        manager,
      );

      return (await this.findById(id, manager)) as ProductDetailResponseDto;
    });
  }

  async archive(id: string): Promise<ProductDetailResponseDto> {
    return this.transactionService.run(async (manager) => {
      const productRepo = manager.getRepository(Product);

      const product = await productRepo.findOne({ where: { id } });
      if (!product) throw AppException.notFound("Product");

      const oldStatus = product.status; // captured BEFORE mutating
      await productRepo.update({ id }, { status: "archived" });

      await this.auditService.record(
        { action: "product:archive", entityType: "Product", entityId: id, diff: { status: { old: oldStatus, new: "archived" } } },
        manager,
      );

      return (await this.findById(id, manager)) as ProductDetailResponseDto;
    });
  }

  /* ───────────── options (reconcile) ───────────── */

  /**
   * Reconciles by (option name, value): existing option/value rows keep their ids, new ones are created,
   * missing ones are removed. Variants that reference removed values block the change (409) unless `force`,
   * in which case they are deactivated and the removed ids are stripped from their optionValueIds.
   */
  async updateOptions(id: string, input: OptionsUpdateInput): Promise<ProductDetailResponseDto> {
    this.validateOptionsInput(input.options);

    return this.transactionService.run(async (manager) => {
      const optionRepo = manager.getRepository(ProductOption);
      const optionValueRepo = manager.getRepository(ProductOptionValue);

      const product = await manager.getRepository(Product).findOne({ where: { id } });
      if (!product) throw AppException.notFound("Product");

      const oldOptions = await optionRepo.find({ where: { productId: id }, order: { position: "ASC" } });
      const oldValues =
        oldOptions.length > 0 ? await optionValueRepo.find({ where: { optionId: In(oldOptions.map((o) => o.id)) } }) : [];

      const oldByName = new Map(oldOptions.map((o) => [o.name, o]));
      const newNames = new Set(input.options.map((o) => o.name));

      // Values that will disappear: all values of removed options + values of kept options not re-sent.
      const removedValueIds = new Set<string>();
      const removedValueLabels = new Map<string, string>();
      for (const ov of oldValues) {
        const opt = oldOptions.find((o) => o.id === ov.optionId)!;
        const keptOpt = newNames.has(opt.name) ? input.options.find((o) => o.name === opt.name)! : null;
        const kept = keptOpt ? keptOpt.values.some((v) => v.value === ov.value) : false;
        if (!kept) {
          removedValueIds.add(ov.id);
          removedValueLabels.set(ov.id, `${opt.name}: ${ov.value}`);
        }
      }

      const variantRepo = manager.getRepository(Variant);
      const variants = await variantRepo.find({ where: { productId: id } });
      const affected = variants.filter((v) => v.optionValueIds.some((vid) => removedValueIds.has(vid)));
      const affectedActive = affected.filter((v) => v.isActive);

      if (affectedActive.length > 0 && !input.force) {
        throw AppException.conflict("OPTION_VALUES_IN_USE", "Some option values to remove are used by active variants; retry with force=true to deactivate them", {
          variants: affectedActive.map((v) => ({ id: v.id, title: v.title })),
          removedValues: [...new Set(affectedActive.flatMap((v) => v.optionValueIds.filter((x) => removedValueIds.has(x))))].map((x) => ({
            id: x,
            label: removedValueLabels.get(x),
          })),
        });
      }

      // 1. Remove what disappeared.
      if (removedValueIds.size > 0) await optionValueRepo.delete({ id: In([...removedValueIds]) });
      const removedOptions = oldOptions.filter((o) => !newNames.has(o.name));
      if (removedOptions.length > 0) await optionRepo.delete({ id: In(removedOptions.map((o) => o.id)) });

      // 2. Upsert options and values, preserving ids.
      for (let i = 0; i < input.options.length; i++) {
        const optInput = input.options[i];
        let option = oldByName.get(optInput.name);
        if (option) {
          if (option.position !== i) await optionRepo.update({ id: option.id }, { position: i });
        } else {
          option = new ProductOption();
          option.id = uuidv7();
          option.productId = id;
          option.name = optInput.name;
          option.position = i;
          option = await optionRepo.save(option);
        }

        const existingByValue = new Map(oldValues.filter((v) => v.optionId === option!.id).map((v) => [v.value, v]));
        for (let j = 0; j < optInput.values.length; j++) {
          const existing = existingByValue.get(optInput.values[j].value);
          if (existing) {
            if (existing.position !== j) await optionValueRepo.update({ id: existing.id }, { position: j });
          } else {
            const value = new ProductOptionValue();
            value.id = uuidv7();
            value.optionId = option.id;
            value.value = optInput.values[j].value;
            value.position = j;
            await optionValueRepo.save(value);
          }
        }
      }

      // a live product must keep at least one sellable variant even when force removes option values
      const productRow = product;
      const survivors = variants.filter((v) => v.isActive && !affected.some((a) => a.id === v.id));
      if (productRow?.status === "active" && survivors.length === 0) {
        throw AppException.conflict("LAST_ACTIVE_VARIANT", "This change would leave a published product without active variants; archive it first");
      }

      // 3. Fix variants: strip removed ids everywhere; deactivate the active ones (only reachable with force).
      for (const v of affected) {
        await manager
          .createQueryBuilder()
          .update(Variant)
          .set({
            optionValueIds: v.optionValueIds.filter((x) => !removedValueIds.has(x)),
            ...(v.isActive ? { isActive: false } : {}),
            version: () => "version + 1",
          })
          .where("id = :id", { id: v.id })
          .execute();
      }

      await this.auditService.record(
        {
          action: "product:update:options",
          entityType: "Product",
          entityId: id,
          diff: {
            optionsCount: { old: oldOptions.length, new: input.options.length },
            removedValues: [...removedValueLabels.values()],
            deactivatedVariantIds: affectedActive.map((v) => v.id),
            force: input.force,
          },
        },
        manager,
      );

      return (await this.findById(id, manager)) as ProductDetailResponseDto;
    });
  }

  /* ───────────── media ───────────── */

  async updateMedia(id: string, input: MediaUpdateInput): Promise<ProductDetailResponseDto> {
    this.assertUnique(input.media.map((m) => m.url), "Duplicate media URL");

    return this.transactionService.run(async (manager) => {
      const mediaRepo = manager.getRepository(Media);
      const productMediaRepo = manager.getRepository(ProductMedia);

      const product = await manager.getRepository(Product).findOne({ where: { id } });
      if (!product) throw AppException.notFound("Product");

      const variantIds = [...new Set(input.media.map((m) => m.variantId).filter((v): v is string => !!v))];
      if (variantIds.length > 0) {
        const found = await manager.getRepository(Variant).find({ where: { id: In(variantIds), productId: id }, select: { id: true } });
        const foundIds = new Set(found.map((v) => v.id));
        const missing = variantIds.filter((v) => !foundIds.has(v));
        if (missing.length > 0) {
          throw AppException.badRequest("BAD_REQUEST", "variantId does not belong to this product", { variantIds: missing });
        }
      }

      const oldProductMedia = await productMediaRepo.find({ where: { productId: id }, order: { position: "ASC" } });
      const oldMedia =
        oldProductMedia.length > 0 ? await mediaRepo.find({ where: { id: In(oldProductMedia.map((pm) => pm.mediaId)) } }) : [];
      const urlById = new Map(oldMedia.map((m) => [m.id, m.url]));
      const oldUrls = oldProductMedia.map((pm) => urlById.get(pm.mediaId) ?? pm.mediaId);

      await productMediaRepo.delete({ productId: id });

      for (let i = 0; i < input.media.length; i++) {
        const mediaInput = input.media[i];

        let mediaId: string;
        const existingMedia = await mediaRepo.findOne({ where: { url: mediaInput.url } });
        if (existingMedia) {
          mediaId = existingMedia.id;
        } else {
          const newMedia = new Media();
          newMedia.id = uuidv7();
          newMedia.url = mediaInput.url;
          newMedia.alt = mediaInput.alt ?? null;
          mediaId = (await mediaRepo.save(newMedia)).id;
        }

        const productMedia = new ProductMedia();
        productMedia.id = uuidv7();
        productMedia.productId = id;
        productMedia.mediaId = mediaId;
        productMedia.variantId = mediaInput.variantId ?? null;
        productMedia.position = i;
        await productMediaRepo.save(productMedia);
      }

      await this.auditService.record(
        {
          action: "product:update:media",
          entityType: "Product",
          entityId: id,
          diff: { media: { old: oldUrls, new: input.media.map((m) => m.url) }, mediaCount: { old: oldUrls.length, new: input.media.length } },
        },
        manager,
      );

      return (await this.findById(id, manager)) as ProductDetailResponseDto;
    });
  }

  /* ───────────── bulk ───────────── */

  async bulkAction(input: BulkActionInput): Promise<BulkActionResult> {
    if ((input.action === "add_tags" || input.action === "remove_tags") && (!input.tags || input.tags.length === 0)) {
      throw AppException.badRequest("BAD_REQUEST", "tags are required for this action");
    }
    const ids = [...new Set(input.ids)];

    return this.transactionService.run(async (manager) => {
      const productRepo = manager.getRepository(Product);
      const products = await productRepo.find({ where: { id: In(ids) } });
      if (products.length === 0) throw AppException.notFound("Products");

      const found = new Set(products.map((p) => p.id));
      const skipped: BulkActionResult["skipped"] = ids.filter((i) => !found.has(i)).map((i) => ({ id: i, reason: "NOT_FOUND" }));
      const processed: string[] = [];
      const toDelete: string[] = [];

      for (const product of products) {
        let diff: Record<string, unknown>;

        if (input.action === "publish") {
          if (product.status === "active") {
            skipped.push({ id: product.id, reason: "ALREADY_ACTIVE" });
            continue;
          }
          if (!(await this.hasPublishableVariant(product.id, manager))) {
            skipped.push({ id: product.id, reason: "NO_ACTIVE_VARIANT_WITH_PRICE" });
            continue;
          }
          const publishedAt = this.clock.now();
          diff = { status: { old: product.status, new: "active" }, publishedAt: { old: product.publishedAt ?? null, new: publishedAt } };
          await productRepo.update({ id: product.id }, { status: "active", publishedAt });
        } else if (input.action === "archive") {
          if (product.status === "archived") {
            skipped.push({ id: product.id, reason: "ALREADY_ARCHIVED" });
            continue;
          }
          diff = { status: { old: product.status, new: "archived" } };
          await productRepo.update({ id: product.id }, { status: "archived" });
        } else if (input.action === "delete") {
          diff = { deleted: true, status: { old: product.status } };
          toDelete.push(product.id);
        } else if (input.action === "add_tags") {
          const tags = Array.from(new Set([...product.tags, ...input.tags!]));
          if (tags.length === product.tags.length) {
            skipped.push({ id: product.id, reason: "NO_CHANGE" });
            continue;
          }
          diff = { tags: { old: product.tags, new: tags } };
          await productRepo.update({ id: product.id }, { tags });
        } else {
          const tags = product.tags.filter((t) => !input.tags!.includes(t));
          if (tags.length === product.tags.length) {
            skipped.push({ id: product.id, reason: "NO_CHANGE" });
            continue;
          }
          diff = { tags: { old: product.tags, new: tags } };
          await productRepo.update({ id: product.id }, { tags });
        }

        processed.push(product.id);
        await this.auditService.record(
          {
            action: `product:bulk:${input.action}`,
            entityType: "Product",
            entityId: product.id,
            diff: { action: input.action, ids, ...diff },
          },
          manager,
        );
      }

      await this.softDeleteProducts(toDelete, manager);

      return { action: input.action, processed, skipped };
    });
  }

  private isDuplicateKeyError(err: unknown): boolean {
    if (err === null || err === undefined || typeof err !== "object") return false;
    const driverError = (err as Record<string, unknown>).driverError;
    if (driverError === null || driverError === undefined || typeof driverError !== "object") return false;
    return (driverError as Record<string, unknown>).code === "23505";
  }
}
