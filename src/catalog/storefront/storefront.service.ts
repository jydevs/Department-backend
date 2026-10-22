import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository, IsNull, In } from "typeorm";
import {
  Product,
  Variant,
  ProductOption,
  ProductOptionValue,
  ProductMedia,
  Media,
  Collection,
  Metafield,
} from "../../catalog/entities";
import { AppException } from "../../common/errors/app-exception";
import { CursorPage, decodeCursor, encodeCursor } from "../../common/pagination/pagination";
import { escapeLike } from "../../common/sql/escape-like";
import { SqlParams } from "../../common/sql/sql-params";
import { buildSmartRulesCondition, collectionRulesSchema } from "../collections";
import {
  StorefrontImage,
  StorefrontProductDetails,
  StorefrontProductSummary,
  StorefrontProductsQuery,
  StorefrontCollectionSummary,
  StorefrontCollectionDetails,
  StorefrontSearchQuery,
  StorefrontCollectionQuery,
} from "./dto";
import { z } from "zod";

type SortKey = "newest" | "price_asc" | "price_desc" | "title" | "manual";

interface SortSpec {
  expr: string;
  dir: "ASC" | "DESC";
  kind: "date" | "number" | "text";
}

/** Fixed whitelist: the ORDER BY expression never comes from user input. */
const SORTS: Record<SortKey, SortSpec> = {
  newest: { expr: "COALESCE(p.published_at, p.created_at)", dir: "DESC", kind: "date" },
  price_asc: { expr: "COALESCE(pr.min_price, 0)", dir: "ASC", kind: "number" },
  price_desc: { expr: "COALESCE(pr.max_price, 0)", dir: "DESC", kind: "number" },
  title: { expr: "LOWER(p.title)", dir: "ASC", kind: "text" },
  manual: { expr: "cp.position", dir: "ASC", kind: "number" },
};

const CAST: Record<SortSpec["kind"], string> = { date: "timestamptz", number: "bigint", text: "text" };

const productCursorSchema = z.object({
  k: z.union([z.string().max(300), z.number()]),
  id: z.string().uuid(),
});

interface IdRow {
  id: string;
  k: unknown;
}

interface PageQuery {
  sort: SortKey;
  limit: number;
  cursor?: string;
  tag?: string;
  q?: string;
  available?: boolean;
  collection?: Collection;
}

interface ProductIdPage {
  ids: string[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
}

/** Same rule as getAvailabilityMap, evaluated per product for the `available` filter. */
const PRODUCT_AVAILABLE_SQL = `EXISTS (
  SELECT 1 FROM variants av WHERE av.product_id = p.id AND av.is_active = true AND (
    NOT av.track_inventory OR av.allow_backorder OR COALESCE((
      SELECT SUM(il.on_hand - il.reserved) FROM inventory_levels il
      JOIN locations l ON l.id = il.location_id AND l.is_active = true WHERE il.variant_id = av.id
    ), 0) > 0))`;

const MAX_SUMMARY_VARIANTS = 100;

@Injectable()
export class StorefrontService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Variant)
    private readonly variantRepository: Repository<Variant>,
    @InjectRepository(ProductOption)
    private readonly optionRepository: Repository<ProductOption>,
    @InjectRepository(ProductOptionValue)
    private readonly optionValueRepository: Repository<ProductOptionValue>,
    @InjectRepository(ProductMedia)
    private readonly productMediaRepository: Repository<ProductMedia>,
    @InjectRepository(Media)
    private readonly mediaRepository: Repository<Media>,
    @InjectRepository(Collection)
    private readonly collectionRepository: Repository<Collection>,
    @InjectRepository(Metafield)
    private readonly metafieldRepository: Repository<Metafield>,
    private readonly dataSource: DataSource,
  ) {}

  async listProducts(query: StorefrontProductsQuery): Promise<CursorPage<StorefrontProductSummary> & { total: number }> {
    const limit = query.limit ?? 24;
    let collection: Collection | undefined;
    if (query.collection) {
      const found = await this.findPublishedCollection(query.collection);
      if (!found) return { items: [], hasMore: false, nextCursor: null, total: 0 };
      collection = found;
    }

    const page = await this.queryProductIds({
      sort: query.sort ?? "newest",
      limit,
      cursor: query.cursor,
      tag: query.tag,
      q: query.q,
      available: query.available,
      collection,
    });
    return { items: await this.loadSummaries(page.ids), hasMore: page.hasMore, nextCursor: page.nextCursor, total: page.total };
  }

  async getProductByHandle(handle: string): Promise<StorefrontProductDetails | null> {
    const product = await this.productRepository.findOne({
      where: { handle, status: "active", deletedAt: IsNull() },
    });

    if (!product) {
      return null;
    }

    // Fetch variants
    const variants = await this.variantRepository.find({
      where: { productId: product.id, isActive: true },
      order: { position: "ASC" },
    });

    // Fetch availability
    const variantIds = variants.map((v) => v.id);
    const availabilityMap = await this.getAvailabilityMap(variantIds);

    // Fetch options
    const options = await this.optionRepository.find({
      where: { productId: product.id },
      order: { position: "ASC" },
    });

    const optionValueIds = options.length > 0 ? options.map((o) => o.id) : [];
    const optionValues = optionValueIds.length > 0
      ? await this.optionValueRepository.find({
          where: { optionId: In(optionValueIds) },
        })
      : [];

    // Fetch media
    const media = await this.productMediaRepository.find({
      where: { productId: product.id },
      relations: { media: true },
      order: { position: "ASC" },
    });

    // Fetch metafields (only custom namespace)
    const metafields = await this.metafieldRepository.find({
      where: { ownerType: "product", ownerId: product.id, namespace: "custom" },
    });

    // Build DTO
    const variantDtos = variants.map((v) => {
      const optionValueIdList = v.optionValueIds ?? [];
      const optionValueList = optionValues.filter((ov) => optionValueIdList.includes(ov.id));
      const optionValueDtos = optionValueList.map((ov) => {
        const option = options.find((o) => o.id === ov.optionId);
        return {
          id: ov.id,
          name: option?.name ?? "",
          value: ov.value,
        };
      });

      return {
        id: v.id,
        title: v.title,
        sku: v.sku ?? null,
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? null,
        available: availabilityMap.get(v.id) === true,
        optionValues: optionValueDtos,
      };
    });

    const optionDtos = options.map((o) => {
      const values = optionValues.filter((ov) => ov.optionId === o.id).map((ov) => ov.value);
      return {
        id: o.id,
        name: o.name,
        values,
      };
    });

    const mediaDtos = media
      .filter((pm) => pm.media)
      .map((pm) => ({
        id: pm.media!.id,
        url: pm.media!.url,
        alt: pm.media!.alt ?? null,
        width: pm.media!.width ?? null,
        height: pm.media!.height ?? null,
      }));

    const metafieldDtos = metafields.map((mf) => ({
      key: mf.key,
      value: mf.value,
    }));

    return {
      id: product.id,
      handle: product.handle,
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      vendor: product.vendor ?? null,
      productType: product.productType ?? null,
      tags: product.tags ?? [],
      variants: variantDtos,
      options: optionDtos,
      media: mediaDtos,
      metafields: metafieldDtos,
      seo: {
        title: product.seoTitle ?? null,
        description: product.seoDescription ?? null,
      },
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  async listCollections(): Promise<StorefrontCollectionSummary[]> {
    const collections = await this.collectionRepository.find({
      where: { isPublished: true, deletedAt: IsNull() },
      order: { createdAt: "DESC" },
    });
    return this.toCollectionSummaries(collections);
  }

  /** Collection + first page of its products, or null when it is missing/unpublished/deleted. */
  async getCollectionPage(
    handle: string,
    query: Partial<StorefrontCollectionQuery>,
  ): Promise<{ collection: StorefrontCollectionDetails; products: CursorPage<StorefrontProductSummary> & { total: number } } | null> {
    const collection = await this.findPublishedCollection(handle);
    if (!collection) return null;

    const images = await this.loadCollectionImages([collection]);
    const details: StorefrontCollectionDetails = {
      id: collection.id,
      handle: collection.handle,
      title: collection.title,
      descriptionHtml: collection.descriptionHtml,
      image: images.get(collection.id) ?? null,
      seo: {
        title: collection.seoTitle ?? null,
        description: collection.seoDescription ?? null,
      },
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    };

    let sort: SortKey;
    if (collection.sortOrder === "manual") {
      sort = collection.type === "manual" ? "manual" : "newest";
    } else if (collection.sortOrder === "title" || collection.sortOrder === "price_asc" || collection.sortOrder === "price_desc") {
      sort = collection.sortOrder;
    } else {
      sort = "newest";
    }

    const page = await this.queryProductIds({ sort, limit: query.limit ?? 24, cursor: query.cursor, available: query.available, collection });
    return {
      collection: details,
      products: { items: await this.loadSummaries(page.ids), hasMore: page.hasMore, nextCursor: page.nextCursor, total: page.total },
    };
  }

  async search(query: StorefrontSearchQuery): Promise<{ products: StorefrontProductSummary[]; collections: StorefrontCollectionSummary[] }> {
    const page = await this.queryProductIds({ sort: "newest", limit: 24, q: query.q });

    const collections = await this.collectionRepository
      .createQueryBuilder("c")
      .where("c.isPublished = true")
      .andWhere("c.deletedAt IS NULL")
      .andWhere("(c.title ILIKE :q OR c.handle ILIKE :q)", { q: `%${escapeLike(query.q)}%` })
      .orderBy("c.createdAt", "DESC")
      .addOrderBy("c.id", "ASC")
      .limit(24)
      .getMany();

    return {
      products: await this.loadSummaries(page.ids),
      collections: await this.toCollectionSummaries(collections),
    };
  }

  private findPublishedCollection(handle: string): Promise<Collection | null> {
    return this.collectionRepository.findOne({ where: { handle, isPublished: true, deletedAt: IsNull() } });
  }

  /** WHERE / JOIN fragments shared by the page query and the COUNT (everything except the cursor). */
  private buildFilters(q: PageQuery, params: SqlParams): { joins: string[]; where: string[] } {
    const joins: string[] = [];
    const where: string[] = ["p.status = 'active'", "p.deleted_at IS NULL"];

    if (q.collection) {
      if (q.collection.type === "smart") {
        const parsed = collectionRulesSchema.safeParse(q.collection.rules);
        where.push(parsed.success ? buildSmartRulesCondition(parsed.data, params) : "FALSE");
      } else {
        joins.push(`JOIN collection_products cp ON cp.product_id = p.id AND cp.collection_id = ${params.push(q.collection.id)}::uuid`);
      }
    }
    if (q.tag) {
      where.push(`p.tags @> ARRAY[${params.push(q.tag)}]::text[]`);
    }
    if (q.q) {
      const ph = params.push(`%${escapeLike(q.q)}%`);
      where.push(
        `(p.title ILIKE ${ph} OR p.handle ILIKE ${ph} OR EXISTS (SELECT 1 FROM variants sv WHERE sv.product_id = p.id AND sv.is_active = true AND sv.sku ILIKE ${ph}))`,
      );
    }
    if (q.available !== undefined) {
      where.push(q.available ? PRODUCT_AVAILABLE_SQL : `NOT ${PRODUCT_AVAILABLE_SQL}`);
    }
    return { joins, where };
  }

  /** Step (a): ordered ids only, keyset-paginated with a parameterised query (limit + 1 to detect more). */
  private async queryProductIds(q: PageQuery): Promise<ProductIdPage> {
    const spec = SORTS[q.sort];
    const params = new SqlParams();
    const { joins, where } = this.buildFilters(q, params);

    if (q.cursor) {
      const cursor = decodeCursor(q.cursor, productCursorSchema);
      const valid =
        (spec.kind === "date" && typeof cursor.k === "string" && z.string().datetime().safeParse(cursor.k).success) ||
        (spec.kind === "number" && typeof cursor.k === "number" && Number.isSafeInteger(cursor.k) && cursor.k >= 0) ||
        (spec.kind === "text" && typeof cursor.k === "string");
      if (!valid) {
        throw AppException.badRequest("INVALID_CURSOR", "Invalid pagination cursor");
      }
      const kPh = `${params.push(cursor.k)}::${CAST[spec.kind]}`;
      const idPh = `${params.push(cursor.id)}::uuid`;
      const cmp = spec.dir === "ASC" ? ">" : "<";
      where.push(`((${spec.expr} ${cmp} ${kPh}) OR (${spec.expr} = ${kPh} AND p.id > ${idPh}))`);
    }

    const limitPh = params.push(q.limit + 1);
    const sql = `SELECT p.id AS id, ${spec.expr} AS k
      FROM products p
      LEFT JOIN LATERAL (
        SELECT MIN(v.price) AS min_price, MAX(v.price) AS max_price
        FROM variants v WHERE v.product_id = p.id AND v.is_active = true
      ) pr ON true
      ${joins.join(" ")}
      WHERE ${where.join(" AND ")}
      ORDER BY ${spec.expr} ${spec.dir}, p.id ASC
      LIMIT ${limitPh}`;

    // Total of the filtered set (without the cursor): a parallel COUNT with its own parameters.
    const countParams = new SqlParams();
    const countFilters = this.buildFilters(q, countParams);
    const countSql = `SELECT COUNT(*)::int AS n FROM products p ${countFilters.joins.join(" ")} WHERE ${countFilters.where.join(" AND ")}`;

    const [rows, countRows]: [IdRow[], { n: number }[]] = await Promise.all([
      this.dataSource.query(sql, params.values),
      this.dataSource.query(countSql, countParams.values),
    ]);
    const hasMore = rows.length > q.limit;
    const pageRows = hasMore ? rows.slice(0, q.limit) : rows;
    const last = pageRows[pageRows.length - 1];

    let nextCursor: string | null = null;
    if (hasMore && last) {
      let k: string | number;
      if (last.k instanceof Date) k = last.k.toISOString();
      else if (spec.kind === "number") k = Number(last.k);
      else k = String(last.k);
      nextCursor = encodeCursor({ k, id: last.id });
    }
    return { ids: pageRows.map((r) => r.id), hasMore, nextCursor, total: countRows[0]?.n ?? 0 };
  }

  /** Step (c): load the page's products with variants, options and images in batch queries (no N+1), keep the SQL order. */
  private async loadSummaries(ids: string[]): Promise<StorefrontProductSummary[]> {
    if (ids.length === 0) return [];

    const products = await this.productRepository.find({ where: { id: In(ids) }, relations: { variants: true } });
    const byId = new Map(products.map((p) => [p.id, p]));

    const media = await this.productMediaRepository.find({
      where: { productId: In(ids) },
      relations: { media: true },
      order: { position: "ASC", id: "ASC" },
    });
    const imagesByProduct = new Map<string, StorefrontImage[]>();
    for (const pm of media) {
      if (!pm.media) continue;
      const list = imagesByProduct.get(pm.productId) ?? [];
      if (list.length < 2) list.push(this.toImage(pm.media));
      imagesByProduct.set(pm.productId, list);
    }

    const options = await this.optionRepository.find({ where: { productId: In(ids) } });
    const optionValues = options.length > 0 ? await this.optionValueRepository.find({ where: { optionId: In(options.map((o) => o.id)) } }) : [];
    const optionNameById = new Map(options.map((o) => [o.id, o.name]));
    const optionValueById = new Map(optionValues.map((ov) => [ov.id, { name: optionNameById.get(ov.optionId) ?? "", value: ov.value }]));

    const activeVariants = (p: Product) => (p.variants ?? []).filter((v) => v.isActive).sort((a, b) => a.position - b.position);
    const availability = await this.getAvailabilityMap(products.flatMap((p) => activeVariants(p).map((v) => v.id)));

    const summaries: StorefrontProductSummary[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) continue;
      const variants = activeVariants(p);
      const discounted = variants.filter((v) => v.compareAtPrice != null && v.compareAtPrice > v.price).map((v) => v.compareAtPrice as number);
      const images = imagesByProduct.get(p.id) ?? [];
      summaries.push({
        id: p.id,
        handle: p.handle,
        title: p.title,
        price: variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : 0,
        image: images[0] ?? null,
        available: variants.some((v) => availability.get(v.id) === true),
        compareAtPrice: discounted.length > 0 ? Math.min(...discounted) : null,
        hoverImage: images[1] ?? null,
        tags: p.tags ?? [],
        vendor: p.vendor ?? null,
        updatedAt: p.updatedAt,
        variants: variants.slice(0, MAX_SUMMARY_VARIANTS).map((v) => ({
          id: v.id,
          title: v.title,
          price: v.price,
          compareAtPrice: v.compareAtPrice ?? null,
          available: availability.get(v.id) === true,
          options: (v.optionValueIds ?? []).map((ovId) => optionValueById.get(ovId)).filter((o): o is { name: string; value: string } => !!o),
        })),
      });
    }
    return summaries;
  }

  private toImage(media: Media): StorefrontImage {
    return { url: media.url, alt: media.alt ?? null, width: media.width ?? null, height: media.height ?? null };
  }

  private async loadCollectionImages(collections: Collection[]): Promise<Map<string, StorefrontImage>> {
    const mediaIds = collections.map((c) => c.imageMediaId).filter((id): id is string => !!id);
    const result = new Map<string, StorefrontImage>();
    if (mediaIds.length === 0) return result;

    const media = await this.mediaRepository.find({ where: { id: In(mediaIds) } });
    const mediaById = new Map(media.map((m) => [m.id, m]));
    for (const c of collections) {
      const m = c.imageMediaId ? mediaById.get(c.imageMediaId) : undefined;
      if (m) result.set(c.id, this.toImage(m));
    }
    return result;
  }

  private async toCollectionSummaries(collections: Collection[]): Promise<StorefrontCollectionSummary[]> {
    const images = await this.loadCollectionImages(collections);
    return collections.map((c) => ({ id: c.id, handle: c.handle, title: c.title, image: images.get(c.id) ?? null }));
  }

  /** One aggregate query for every variant on the page: no N+1. */
  private async getAvailabilityMap(variantIds: string[]): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    if (variantIds.length === 0) return map;

    const rows: { id: string; available: boolean }[] = await this.dataSource.query(
      `SELECT v.id AS id,
         (NOT v.track_inventory OR v.allow_backorder
           OR COALESCE(SUM(il.on_hand - il.reserved) FILTER (WHERE l.is_active = true), 0) > 0) AS available
       FROM variants v
       LEFT JOIN inventory_levels il ON il.variant_id = v.id
       LEFT JOIN locations l ON l.id = il.location_id
       WHERE v.id = ANY($1::uuid[])
       GROUP BY v.id`,
      [variantIds],
    );
    for (const r of rows) map.set(r.id, r.available === true);
    return map;
  }
}
