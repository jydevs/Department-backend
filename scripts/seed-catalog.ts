import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DataSource } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { AppModule } from "../src/app.module";
import { loadDotEnv } from "../src/config/env";
import { Collection } from "../src/catalog/entities/collection.entity";
import { CollectionProduct } from "../src/catalog/entities/collection-product.entity";
import { Media } from "../src/catalog/entities/media.entity";
import { Product } from "../src/catalog/entities/product.entity";
import { Variant } from "../src/catalog/entities/variant.entity";
import { CollectionsService } from "../src/catalog/collections/collections.service";
import { ProductsService } from "../src/catalog/products/products.service";
import { InventoryService } from "../src/inventory/inventory.service";

/**
 * `yarn catalog:seed [--force]` — demo catalogue transcribed from the storefront's mock data (src/data/products.ts).
 *
 *  - Without --force it only runs when there are NO products yet.
 *  - With --force it adds the products / collections that are missing (matched by handle) and never touches existing ones.
 *  - Images are stored as relative paths (`/images/...`) served by the storefront's public/ folder.
 *  - Every variant gets 10 units in the default location (created as "Bogotá" when none exists);
 *    the "agotado" demo product is left without stock.
 */

type CollectionHandle = "all" | "men" | "women";

interface DemoProduct {
  handle: string;
  name: string;
  price: number;
  compareAtPrice?: number;
  soldOut?: boolean;
  collections: CollectionHandle[];
  imageLabel: string;
  images: string[];
  description: string;
  productType: string;
}

const SIZES = ["S", "M", "L", "XL"];
const STOCK_PER_VARIANT = 10;
const VENDOR = "Daregular Dept.";
const COLLECTION_BLURB = "de la colección Rags to Riches – Extended Version.";

/** `/images/product-<handle>.jpg`, then `-2`, `-3`… */
function gallery(handle: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => (i === 0 ? `/images/product-${handle}.jpg` : `/images/product-${handle}-${i + 1}.jpg`));
}

const PRODUCTS: DemoProduct[] = [
  {
    handle: "basic-r2r-t-shirt",
    name: "Basic R2R - T Shirt",
    price: 99000,
    collections: ["all", "men"],
    imageLabel: "Basic R2R tee",
    images: gallery("basic-r2r-t-shirt", 3),
    description: `Camiseta básica ${COLLECTION_BLURB}`,
    productType: "Camiseta",
  },
  {
    handle: "out-of-stock-product",
    name: "Out of Stock - Product",
    price: 99000,
    soldOut: true,
    collections: ["all"],
    imageLabel: "Out of stock tee",
    images: gallery("basic-r2r-t-shirt", 2),
    description: "Producto agotado.",
    productType: "Camiseta",
  },
  {
    handle: "four-oh-four-short",
    name: "Four Oh Four - Short",
    price: 99000,
    collections: ["all", "men"],
    imageLabel: "Four Oh Four short",
    images: gallery("four-oh-four-short", 3),
    description: `Short con el estampado 404, ${COLLECTION_BLURB}`,
    productType: "Short",
  },
  {
    handle: "get-rich-cropped-boxy-fit",
    name: "Get Rich - Cropped Boxy Fit",
    price: 119000,
    collections: ["all", "women"],
    imageLabel: "Get Rich cropped boxy tee",
    images: gallery("get-rich-cropped-boxy-fit", 2),
    description: `Camiseta cropped de corte boxy, ${COLLECTION_BLURB}`,
    productType: "Camiseta",
  },
  {
    handle: "get-rich-or-die-tryin-boxy-fit",
    name: "Get Rich Or Die Tryin' - Boxy Fit",
    price: 99000,
    collections: ["all", "men"],
    imageLabel: "Get Rich Or Die Tryin' boxy tee",
    images: gallery("get-rich-or-die-tryin-boxy-fit", 2),
    description: `Camiseta de corte boxy, ${COLLECTION_BLURB}`,
    productType: "Camiseta",
  },
  {
    handle: "guerrilla-short",
    name: "Guerrilla - Short",
    price: 120000,
    collections: ["all", "men"],
    imageLabel: "Guerrilla short",
    // photo order tuned so the first shot actually shows the shorts
    images: ["/images/product-guerrilla-short-2.jpg", "/images/product-guerrilla-short.jpg", "/images/product-guerrilla-short-3.jpg"],
    description: `Short ${COLLECTION_BLURB}`,
    productType: "Short",
  },
  {
    handle: "rags-2-ritches-cropped-boxy-fit",
    name: "Rags 2 Ritches - Cropped Boxy Fit",
    price: 99000,
    collections: ["all", "women"],
    imageLabel: "Rags 2 Ritches cropped boxy tee",
    images: gallery("rags-2-ritches-cropped-boxy-fit", 2),
    description: `Camiseta cropped de corte boxy, ${COLLECTION_BLURB}`,
    productType: "Camiseta",
  },
  {
    handle: "samo-hoodie",
    name: "Samo - Hoodie",
    price: 190000,
    collections: ["all", "men"],
    imageLabel: "Samo hoodie",
    images: gallery("samo-hoodie", 3),
    description: `Hoodie ${COLLECTION_BLURB}`,
    productType: "Hoodie",
  },
  {
    handle: "take-the-risk-boxy-fit",
    name: "Take The Risk - Boxy Fit",
    price: 120000,
    compareAtPrice: 180000,
    collections: ["all", "men"],
    imageLabel: "Take The Risk boxy tee",
    images: gallery("take-the-risk-boxy-fit", 2),
    description: `Camiseta de corte boxy, ${COLLECTION_BLURB}`,
    productType: "Camiseta",
  },
];

interface DemoCollection {
  handle: CollectionHandle;
  title: string;
  tabLabel: string;
  imageUrl: string;
  imageAlt: string;
  description: string;
}

/** The storefront titles all three collection pages "Clothes" (the tab label tells them apart in the SEO title). */
const COLLECTIONS: DemoCollection[] = [
  { handle: "all", title: "Clothes", tabLabel: "Todo", imageUrl: "/images/collection-all.jpg", imageAlt: "Clothes collection hero", description: "Toda la colección Rags to Riches – Extended Version." },
  { handle: "men", title: "Clothes", tabLabel: "Men", imageUrl: "/images/collection-men.jpg", imageAlt: "Men collection hero", description: "Colección Men de Daregular Dept." },
  { handle: "women", title: "Clothes", tabLabel: "Women", imageUrl: "/images/collection-women.jpg", imageAlt: "Women collection hero", description: "Colección Women de Daregular Dept." },
];

async function ensureDefaultLocation(inventory: InventoryService): Promise<string> {
  const locations = await inventory.listLocations();
  const usable = locations.find((l) => l.isDefault && l.isActive) ?? locations.find((l) => l.isActive);
  if (usable) return usable.id;
  const created = await inventory.createLocation({ name: "Bogotá" });
  console.log(`Created location "${created.name}"`);
  return created.id;
}

async function ensureMedia(ds: DataSource, url: string, alt: string): Promise<string> {
  const repo = ds.getRepository(Media);
  const existing = await repo.findOne({ where: { url } });
  if (existing) return existing.id;
  const media = new Media();
  media.id = uuidv7();
  media.url = url;
  media.alt = alt;
  return (await repo.save(media)).id;
}

async function main() {
  loadDotEnv();
  const force = process.argv.includes("--force");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const ds = app.get(DataSource);
    const products = app.get(ProductsService);
    const collections = app.get(CollectionsService);
    const inventory = app.get(InventoryService);

    const productCount = await ds.getRepository(Product).count();
    if (productCount > 0 && !force) {
      console.log(`The catalogue already has ${productCount} product(s): nothing to do (use --force to add the missing demo products).`);
      return;
    }

    const locationId = await ensureDefaultLocation(inventory);
    const idByHandle = new Map<string, string>();
    let created = 0;

    // created in reverse so the storefront's newest-first listing matches the original display order
    for (const demo of [...PRODUCTS].reverse()) {
      const existing = await ds.getRepository(Product).findOne({ where: { handle: demo.handle } });
      if (existing) {
        idByHandle.set(demo.handle, existing.id);
        continue;
      }

      const detail = await products.create({
        title: demo.name,
        handle: demo.handle,
        descriptionHtml: `<p>${demo.description}</p>`,
        vendor: VENDOR,
        productType: demo.productType,
        tags: ["rags-to-riches", ...demo.collections.filter((c) => c !== "all")],
        seoTitle: demo.name,
        seoDescription: demo.description,
        options: [{ name: "Talla", position: 0, values: SIZES.map((value, position) => ({ value, position })) }],
      });
      idByHandle.set(demo.handle, detail.id);

      // the option cartesian product creates the variants at price 0: set real prices / SKUs now
      const variants = await ds.getRepository(Variant).find({ where: { productId: detail.id }, order: { position: "ASC" } });
      for (const variant of variants) {
        await products.updateVariant(detail.id, variant.id, {
          version: variant.version,
          price: demo.price,
          compareAtPrice: demo.compareAtPrice ?? null,
          sku: `${demo.handle}-${variant.title}`.toUpperCase().slice(0, 120),
        });
      }

      await products.updateMedia(detail.id, {
        media: demo.images.map((url, i) => ({ url, alt: i === 0 ? demo.imageLabel : `${demo.imageLabel} (${i + 1})` })),
      });
      await products.publish(detail.id);

      if (!demo.soldOut) {
        for (const variant of variants) {
          await inventory.adjustInventory({ variantId: variant.id, locationId, setTo: STOCK_PER_VARIANT, reason: "received", note: "Stock demo" });
        }
      }
      created += 1;
      console.log(`Product created: ${demo.handle}`);
    }

    // collections (manual, in the storefront's display order)
    for (const demo of COLLECTIONS) {
      const memberIds = PRODUCTS.filter((p) => p.collections.includes(demo.handle))
        .map((p) => idByHandle.get(p.handle))
        .filter((id): id is string => id !== undefined);

      const existing = await collections.findByHandle(demo.handle);
      if (!existing) {
        const imageMediaId = await ensureMedia(ds, demo.imageUrl, demo.imageAlt);
        const collection = await collections.create({
          handle: demo.handle,
          title: demo.title,
          descriptionHtml: `<p>${demo.description}</p>`,
          type: "manual",
          sortOrder: "manual",
          seoTitle: `${demo.title} — ${demo.tabLabel}`,
          seoDescription: demo.description,
          imageMediaId,
          isPublished: true,
        });
        await collections.updateProducts(collection.id, { products: memberIds.map((productId) => ({ productId })) });
        console.log(`Collection created: ${demo.handle} (${memberIds.length} products)`);
      } else if (existing.type === "manual") {
        // add the demo products that are not in it yet, keeping the current order
        const current = await ds.getRepository(CollectionProduct).find({ where: { collectionId: existing.id }, order: { position: "ASC" } });
        const present = new Set(current.map((c) => c.productId));
        const missing = memberIds.filter((id) => !present.has(id));
        if (missing.length > 0) {
          await collections.updateProducts(existing.id, { products: [...current.map((c) => c.productId), ...missing].map((productId) => ({ productId })) });
          console.log(`Collection ${demo.handle}: added ${missing.length} product(s)`);
        }
      }
    }

    // summary
    const total = await ds.getRepository(Collection).count();
    console.log(`Done. ${created} product(s) created; ${total} collection(s) in the store.`);
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error("Error seeding the catalogue:", error);
    process.exit(1);
  },
);
