import { Module } from "@nestjs/common";
import { MetafieldsModule } from "./metafields/metafields.module";
import { CollectionsModule } from "./collections/collections.module";
import { ProductsModule } from "./products/products.module";
import { StorefrontModule } from "./storefront/storefront.module";

@Module({
  imports: [ProductsModule, MetafieldsModule, CollectionsModule, StorefrontModule],
  exports: [ProductsModule, MetafieldsModule, CollectionsModule, StorefrontModule],
})
export class CatalogModule {}
