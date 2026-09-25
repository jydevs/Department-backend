import { Injectable, Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { Media, Product, ProductMedia, ProductOption, ProductOptionValue, Variant } from "../catalog/entities";
import { firstRow } from "../common/sql/query-result";
import { HANDLE_RE, cell, parseBool, parseHttpsUrl, parseMoney, parseNonNegativeInt, parseTags, sanitizeBody } from "./cell-parsers";
import {
  type BatchContext,
  type BatchOutcome,
  type Importer,
  type ImportRow,
  type ImportUnit,
  type PlanResult,
  type UnitOutcome,
  ImportRowException,
  emptyOutcome,
} from "./imports.types";
import type { ImportRowError } from "./entities/import-job.entity";

const MAX_VARIANTS = 100;
const MAX_IMAGES = 100;
const MAX_STOCK = 1_000_000_000;

interface ParsedVariant {
  line: number;
  sku: string | null;
  optionValues: string[];
  title: string;
  price: number;
  compareAtPrice: number | null;
  weightGrams: number | null;
  barcode: string | null;
  trackInventory: boolean;
  allowBackorder: boolean;
  qty: number | null;
}

interface ParsedImage {
  url: string;
  alt: string | null;
  position: number | null;
}

interface ParsedProduct {
  handle: string;
  title: string;
  bodyHtml: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  wantActive: boolean;
  optionNames: string[];
  variants: ParsedVariant[];
  images: ParsedImage[];
}

interface ExistingProduct {
  id: string;
  status: string;
  published_at: Date | null;
  deleted_at: Date | null;
}

const optionValueKey = (values: string[]): string => values.map((v) => v.toLowerCase()).join("\u0000");

/** Shopify "Products" CSV export -> products, options, variants, external image URLs and initial stock. */
@Injectable()
export class ProductImporter implements Importer {
  private readonly logger = new Logger(ProductImporter.name);
  readonly requiredColumns = ["handle", "title"] as const;

  /* ───────────── planning: group rows by Handle, cheap file-level checks ───────────── */

  plan(rows: ImportRow[]): PlanResult {
    const groups = new Map<string, ImportRow[]>();
    const errors: ImportRowError[] = [];
    let rejectedRows = 0;

    for (const row of rows) {
      const handle = cell(row.cells.handle).toLowerCase();
      if (handle === "") {
        errors.push({ row: row.line, code: "MISSING_HANDLE", message: "Handle: required on every row" });
        rejectedRows++;
        continue;
      }
      const list = groups.get(handle);
      if (list) list.push(row);
      else groups.set(handle, [row]);
    }

    const units: ImportUnit[] = [];
    const skuOwner = new Map<string, string>();
    for (const [handle, groupRows] of groups) {
      const line = groupRows[0].line;
      if (!HANDLE_RE.test(handle) || handle.length > 120) {
        errors.push({ row: line, code: "INVALID_HANDLE", message: "Handle: only lowercase letters, digits and hyphens (max 120)" });
        rejectedRows += groupRows.length;
        continue;
      }
      const dup = groupRows
        .map((r) => cell(r.cells.variantsku))
        .filter((s) => s !== "")
        .find((sku) => {
          const owner = skuOwner.get(sku);
          if (owner !== undefined && owner !== handle) return true;
          skuOwner.set(sku, handle);
          return false;
        });
      if (dup !== undefined) {
        errors.push({ row: line, code: "DUPLICATE_SKU", message: "Variant SKU: already used by another product in this file" });
        rejectedRows += groupRows.length;
        continue;
      }
      units.push({ line, rows: groupRows });
    }
    return { units, errors, rejectedRows };
  }

  /* ───────────── batch ───────────── */

  async processBatch(manager: EntityManager, units: ImportUnit[], ctx: BatchContext): Promise<BatchOutcome> {
    const out = emptyOutcome();
    let locationId: string | null | undefined; // undefined = not looked up yet
    const getLocation = async (): Promise<string | null> => {
      if (locationId === undefined) {
        const row = firstRow<{ id: string }>(await manager.query("SELECT id FROM locations WHERE is_default = true AND is_active = true LIMIT 1"));
        locationId = row?.id ?? null;
      }
      return locationId;
    };

    for (const unit of units) {
      out.processedRows += unit.rows.length;
      try {
        const parsed = this.parse(unit);
        const outcome = await manager.transaction((m) => this.upsert(m, parsed, ctx, getLocation)); // SAVEPOINT per product
        out[outcome]++;
      } catch (err) {
        out.errorCount++;
        if (err instanceof ImportRowException) out.errors.push({ row: unit.line, code: err.code, message: err.message });
        else {
          this.logger.error(`Product import failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
          out.errors.push({ row: unit.line, code: "INTERNAL_ERROR", message: "Unexpected error while saving this product" });
        }
      }
    }
    return out;
  }

  /* ───────────── pure validation of one handle group ───────────── */

  private parse(unit: ImportUnit): ParsedProduct {
    const main = unit.rows[0];
    const c = main.cells;
    const handle = cell(c.handle).toLowerCase();

    const title = cell(c.title);
    if (title.length > 255) throw new ImportRowException("INVALID_TITLE", "Title: at most 255 characters");
    const vendor = cell(c.vendor) || null;
    const productType = cell(c.type) || null;
    const seoTitle = cell(c.seotitle) || null;
    const seoDescription = cell(c.seodescription) || null;
    if ((vendor?.length ?? 0) > 255 || (productType?.length ?? 0) > 255 || (seoTitle?.length ?? 0) > 255 || (seoDescription?.length ?? 0) > 1000) {
      throw new ImportRowException("FIELD_TOO_LONG", "Vendor/Type/SEO fields exceed the allowed length");
    }
    const bodyHtml = sanitizeBody(c.bodyhtml ?? "");
    if (bodyHtml.length > 10_000) throw new ImportRowException("BODY_TOO_LONG", "Body (HTML): more than 10000 characters after sanitising");
    const tags = parseTags(c.tags ?? "");

    const statusCell = cell(c.status).toLowerCase();
    let wantActive: boolean;
    if (statusCell !== "") {
      if (!["active", "draft", "archived"].includes(statusCell)) throw new ImportRowException("INVALID_STATUS", "Status: expected active, draft or archived");
      wantActive = statusCell === "active";
    } else {
      const published = cell(c.published);
      const flag = published === "" ? false : parseBool(published);
      if (flag === null) throw new ImportRowException("INVALID_PUBLISHED", "Published: expected true or false");
      wantActive = flag;
    }

    // options (Shopify's placeholder "Title" / "Default Title" means: no options)
    const rawNames = [1, 2, 3].map((n) => cell(c[`option${n}name`]));
    let optionNames = rawNames.filter((n) => n !== "");
    if (rawNames.slice(optionNames.length).some((n) => n !== "")) throw new ImportRowException("INVALID_OPTIONS", "Option names must be filled in order (Option1, Option2, Option3)");
    if (optionNames.length === 1 && optionNames[0].toLowerCase() === "title" && cell(c.option1value).toLowerCase() === "default title") optionNames = [];
    if (new Set(optionNames.map((n) => n.toLowerCase())).size !== optionNames.length) throw new ImportRowException("INVALID_OPTIONS", "Option names must be unique");
    if (optionNames.some((n) => n.length > 255)) throw new ImportRowException("INVALID_OPTIONS", "Option name is too long");

    const variants: ParsedVariant[] = [];
    const images: ParsedImage[] = [];
    const seenKeys = new Set<string>();
    const seenSkus = new Set<string>();
    const seenImages = new Set<string>();

    for (const row of unit.rows) {
      const r = row.cells;
      const sku = cell(r.variantsku);
      const priceText = cell(r.variantprice);
      const values = [1, 2, 3].map((n) => cell(r[`option${n}value`]));
      const isVariantRow = sku !== "" || priceText !== "" || values.some((v) => v !== "");

      const imageSrc = cell(r.imagesrc);
      if (imageSrc !== "") {
        const url = parseHttpsUrl(imageSrc, "Image Src");
        if (!seenImages.has(url)) {
          seenImages.add(url);
          const posText = cell(r.imageposition);
          const alt = cell(r.imagealttext);
          if (alt.length > 500) throw new ImportRowException("FIELD_TOO_LONG", "Image Alt Text: at most 500 characters");
          images.push({ url, alt: alt || null, position: posText === "" ? null : Math.max(1, parseNonNegativeInt(posText, "Image Position", 10_000)) - 1 });
        }
      }
      if (!isVariantRow) continue;

      if (sku.length > 120) throw new ImportRowException("INVALID_SKU", "Variant SKU: at most 120 characters");
      if (sku !== "") {
        if (seenSkus.has(sku)) throw new ImportRowException("DUPLICATE_VARIANT", "Variant SKU: repeated within the product");
        seenSkus.add(sku);
      }
      const optionValues = optionNames.map((_, i) => values[i]);
      if (optionValues.some((v) => v === "")) throw new ImportRowException("MISSING_OPTION_VALUE", "Option value: every variant needs a value for each option");
      if (optionValues.some((v) => v.length > 255)) throw new ImportRowException("INVALID_OPTIONS", "Option value is too long");
      const key = optionValueKey(optionValues);
      if (seenKeys.has(key)) throw new ImportRowException("DUPLICATE_VARIANT", "Two variants share the same option combination");
      seenKeys.add(key);

      if (priceText === "") throw new ImportRowException("INVALID_PRICE", "Variant Price: required");
      const price = parseMoney(priceText, "Variant Price");
      const compareText = cell(r.variantcompareatprice);
      const compareAtPrice = compareText === "" ? null : parseMoney(compareText, "Variant Compare At Price");
      if (compareAtPrice !== null && compareAtPrice < price) throw new ImportRowException("INVALID_PRICE", "Variant Compare At Price: must be greater than or equal to the price");
      const gramsText = cell(r.variantgrams);
      const barcode = cell(r.variantbarcode) || null;
      if ((barcode?.length ?? 0) > 120) throw new ImportRowException("FIELD_TOO_LONG", "Variant Barcode: at most 120 characters");
      const qtyText = cell(r.variantinventoryqty);
      const qty = qtyText === "" ? null : parseNonNegativeInt(qtyText, "Variant Inventory Qty", MAX_STOCK);
      const policy = cell(r.variantinventorypolicy).toLowerCase();
      if (policy !== "" && policy !== "deny" && policy !== "continue") throw new ImportRowException("INVALID_POLICY", "Variant Inventory Policy: expected deny or continue");

      variants.push({
        line: row.line,
        sku: sku || null,
        optionValues,
        title: optionValues.length > 0 ? optionValues.join(" / ") : "Default Title",
        price,
        compareAtPrice,
        weightGrams: gramsText === "" ? null : parseNonNegativeInt(gramsText, "Variant Grams", 100_000_000),
        barcode,
        trackInventory: cell(r.variantinventorytracker) !== "" || qty !== null,
        allowBackorder: policy === "continue",
        qty,
      });
    }

    if (variants.length === 0) throw new ImportRowException("NO_VARIANT", "The product has no variant row (Variant Price is required)");
    if (variants.length > MAX_VARIANTS) throw new ImportRowException("TOO_MANY_VARIANTS", `A product can have at most ${MAX_VARIANTS} variants`);
    if (images.length > MAX_IMAGES) throw new ImportRowException("TOO_MANY_IMAGES", `A product can have at most ${MAX_IMAGES} images`);

    return { handle, title, bodyHtml, vendor, productType, tags, seoTitle, seoDescription, wantActive, optionNames, variants, images };
  }

  /* ───────────── writes for one product (runs inside a savepoint) ───────────── */

  private async upsert(m: EntityManager, p: ParsedProduct, ctx: BatchContext, getLocation: () => Promise<string | null>): Promise<UnitOutcome> {
    const existing = firstRow<ExistingProduct>(await m.query("SELECT id, status, published_at, deleted_at FROM products WHERE handle = $1 LIMIT 1", [p.handle]));
    if (existing?.deleted_at) throw new ImportRowException("HANDLE_DELETED", "Handle: belongs to a deleted product; restore or rename it first");
    if (!existing && p.title === "") throw new ImportRowException("TITLE_REQUIRED", "Title: required to create a product");

    const archived = existing?.status === "archived";
    if (p.wantActive && !archived && !p.variants.some((v) => v.price > 0)) {
      throw new ImportRowException("NOT_PUBLISHABLE", "An active product needs at least one variant with a price above 0");
    }
    const status = archived ? "archived" : p.wantActive ? "active" : "draft";

    const productRepo = m.getRepository(Product);
    let product: Product;
    if (existing) {
      const found = await productRepo.findOne({ where: { id: existing.id } });
      if (!found) throw new ImportRowException("NOT_FOUND", "The product disappeared during the import");
      product = found;
    } else {
      product = new Product();
      product.handle = p.handle;
    }
    if (p.title !== "") product.title = p.title;
    product.descriptionHtml = p.bodyHtml;
    product.vendor = p.vendor;
    product.productType = p.productType;
    product.tags = p.tags;
    product.seoTitle = p.seoTitle;
    product.seoDescription = p.seoDescription;
    product.status = status;
    if (status === "active" && !product.publishedAt) product.publishedAt = ctx.now;
    product = await productRepo.save(product);

    const valueIdsByVariant = await this.syncOptions(m, product.id, p, existing !== undefined);
    const variantIds = await this.syncVariants(m, product.id, p, valueIdsByVariant);
    await this.syncImages(m, product.id, p.images);

    if (p.variants.some((v) => v.qty !== null)) {
      const locationId = await getLocation();
      if (!locationId) throw new ImportRowException("NO_DEFAULT_LOCATION", "Variant Inventory Qty: there is no active default inventory location");
      for (const [i, v] of p.variants.entries()) {
        if (v.qty !== null) await this.setStock(m, variantIds[i], locationId, v.qty, ctx.now);
      }
    }
    return existing ? "updated" : "created";
  }

  /** Returns, for each parsed variant (same order), the option value ids that identify its combination. */
  private async syncOptions(m: EntityManager, productId: string, p: ParsedProduct, isExisting: boolean): Promise<string[][]> {
    const optionRepo = m.getRepository(ProductOption);
    const valueRepo = m.getRepository(ProductOptionValue);

    let options = isExisting ? await optionRepo.find({ where: { productId }, order: { position: "ASC" } }) : [];
    if (isExisting) {
      const same = options.length === p.optionNames.length && options.every((o, i) => o.name.toLowerCase() === p.optionNames[i].toLowerCase());
      if (!same) throw new ImportRowException("OPTIONS_MISMATCH", "The existing product has different options; change them in the admin first");
    } else {
      options = [];
      for (const [i, name] of p.optionNames.entries()) {
        const o = new ProductOption();
        o.productId = productId;
        o.name = name;
        o.position = i;
        options.push(await optionRepo.save(o));
      }
    }

    const idByOption: Array<Map<string, string>> = [];
    for (const option of options) {
      const values = await valueRepo.find({ where: { optionId: option.id }, order: { position: "ASC" } });
      idByOption.push(new Map(values.map((v) => [v.value.toLowerCase(), v.id])));
    }
    const result: string[][] = [];
    for (const variant of p.variants) {
      const ids: string[] = [];
      for (const [i, option] of options.entries()) {
        const value = variant.optionValues[i];
        const map = idByOption[i];
        let id = map.get(value.toLowerCase());
        if (!id) {
          const created = new ProductOptionValue();
          created.optionId = option.id;
          created.value = value;
          created.position = map.size;
          id = (await valueRepo.save(created)).id;
          map.set(value.toLowerCase(), id);
        }
        ids.push(id);
      }
      result.push(ids);
    }
    return result;
  }

  /** Reconciles by SKU (when given) or by option combination; variants missing from the file are left untouched. */
  private async syncVariants(m: EntityManager, productId: string, p: ParsedProduct, valueIds: string[][]): Promise<string[]> {
    const repo = m.getRepository(Variant);
    const current = await repo.find({ where: { productId }, order: { position: "ASC" } });
    const bySku = new Map(current.filter((v) => v.sku).map((v) => [v.sku as string, v]));
    const byCombo = new Map(current.map((v) => [[...v.optionValueIds].sort().join(","), v]));
    const used = new Set<string>();
    let nextPosition = current.reduce((max, v) => Math.max(max, v.position + 1), 0);
    const ids: string[] = [];

    for (const [i, pv] of p.variants.entries()) {
      const combo = [...valueIds[i]].sort().join(",");
      let variant: Variant | undefined;
      if (pv.sku) {
        variant = bySku.get(pv.sku);
        if (!variant) {
          const other = firstRow<{ product_id: string }>(await m.query("SELECT product_id FROM variants WHERE sku = $1 LIMIT 1", [pv.sku]));
          if (other) throw new ImportRowException("SKU_TAKEN", "Variant SKU: already used by a variant of another product");
          const sameCombo = byCombo.get(combo);
          if (sameCombo && !sameCombo.sku) variant = sameCombo; // adopt a SKU-less variant with the same options
        }
      } else {
        variant = byCombo.get(combo);
      }
      if (variant && used.has(variant.id)) throw new ImportRowException("DUPLICATE_VARIANT", "Two rows resolve to the same variant");

      const target = variant ?? new Variant();
      if (!variant) {
        target.productId = productId;
        target.position = nextPosition++;
      }
      target.sku = pv.sku;
      target.title = pv.title;
      target.price = pv.price;
      target.compareAtPrice = pv.compareAtPrice;
      target.weightGrams = pv.weightGrams;
      target.barcode = pv.barcode;
      target.trackInventory = pv.trackInventory;
      target.allowBackorder = pv.allowBackorder;
      target.optionValueIds = valueIds[i];
      target.isActive = true;
      const saved = await repo.save(target);
      used.add(saved.id);
      ids.push(saved.id);
    }
    return ids;
  }

  /** External https URLs only (no download); the manual move to /media is a later step. */
  private async syncImages(m: EntityManager, productId: string, images: ParsedImage[]): Promise<void> {
    if (images.length === 0) return;
    const mediaRepo = m.getRepository(Media);
    const linkRepo = m.getRepository(ProductMedia);
    const links = await linkRepo.find({ where: { productId } });
    const linkByMedia = new Map(links.map((l) => [l.mediaId, l]));

    for (const [i, image] of images.entries()) {
      let media = await mediaRepo.findOne({ where: { url: image.url } });
      if (!media) {
        media = new Media();
        media.url = image.url;
        media.alt = image.alt;
        media = await mediaRepo.save(media);
      } else if (!media.alt && image.alt) {
        media.alt = image.alt;
        media = await mediaRepo.save(media);
      }
      const position = image.position ?? i;
      const link = linkByMedia.get(media.id);
      if (link) {
        if (link.position !== position) {
          link.position = position;
          await linkRepo.save(link);
        }
      } else {
        const created = new ProductMedia();
        created.id = uuidv7();
        created.productId = productId;
        created.mediaId = media.id;
        created.variantId = null;
        created.position = position;
        await linkRepo.save(created);
      }
    }
  }

  /**
   * Shopify's quantity is an absolute level: new stock is a `received` adjustment, a re-import only moves the
   * difference (so it is idempotent). Mirrors InventoryService.adjustInventory on the caller's transaction.
   */
  private async setStock(m: EntityManager, variantId: string, locationId: string, qty: number, now: Date): Promise<void> {
    await m.query(
      `INSERT INTO inventory_levels (id, variant_id, location_id, on_hand, reserved, version, created_at, updated_at)
       VALUES ($1, $2, $3, 0, 0, 1, $4, $4) ON CONFLICT (variant_id, location_id) DO NOTHING`,
      [uuidv7(), variantId, locationId, now],
    );
    const level = firstRow<{ id: string; on_hand: number; reserved: number }>(
      await m.query("SELECT id, on_hand, reserved FROM inventory_levels WHERE variant_id = $1 AND location_id = $2 FOR UPDATE", [variantId, locationId]),
    );
    if (!level) throw new ImportRowException("INVENTORY_ERROR", "Could not create the inventory level");
    const delta = qty - level.on_hand;
    if (delta === 0) return;
    if (qty < level.reserved) throw new ImportRowException("STOCK_BELOW_RESERVED", "Variant Inventory Qty: lower than the units already reserved");
    await m.query("UPDATE inventory_levels SET on_hand = $2, updated_at = $3, version = version + 1 WHERE id = $1", [level.id, qty, now]);
    await m.query(
      `INSERT INTO inventory_adjustments (id, variant_id, location_id, delta, reason, note, actor_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
      [uuidv7(), variantId, locationId, delta, delta > 0 ? "received" : "correction", "Shopify CSV import", now],
    );
  }
}
