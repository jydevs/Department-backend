import { MigrationInterface, QueryRunner } from "typeorm";

export class Catalog1790296815765 implements MigrationInterface {
    name = 'Catalog1790296815765'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "collections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "handle" character varying(120) NOT NULL, "title" character varying(255) NOT NULL, "description_html" text NOT NULL DEFAULT '', "type" character varying(8) NOT NULL, "rules" jsonb, "sort_order" character varying(12) NOT NULL DEFAULT 'manual', "is_published" boolean NOT NULL DEFAULT false, "seo_title" character varying(255), "seo_description" text, "image_media_id" uuid, "deleted_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "UQ_8439e6c41bef1551aee8d921ee6" UNIQUE ("handle"), CONSTRAINT "PK_21c00b1ebbd41ba1354242c5c4e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d913064be09770c224e2bf23da" ON "collections"  ("is_published") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8439e6c41bef1551aee8d921ee" ON "collections"  ("handle") `);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, "handle" character varying(120) NOT NULL, "title" character varying(255) NOT NULL, "description_html" text NOT NULL DEFAULT '', "status" character varying(12) NOT NULL DEFAULT 'draft', "vendor" character varying(255), "product_type" character varying(255), "tags" text array NOT NULL DEFAULT '{}', "seo_title" character varying(255), "seo_description" text, "published_at" TIMESTAMP(3) WITH TIME ZONE, "deleted_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "UQ_463420b2b12dfc8e57c02c952e0" UNIQUE ("handle"), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_28c086ff9c9e8b62e9db742bba" ON "products"  ("status", "published_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_1846199852a695713b1f8f5e9a" ON "products"  ("status") `);
        await queryRunner.query(`CREATE TABLE "collection_products" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "collection_id" uuid NOT NULL, "product_id" uuid NOT NULL, "position" integer NOT NULL, CONSTRAINT "PK_5332f8b4cbc00fba1b092b15837" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cf6d25a1f53ebdf9c1c79ef2ef" ON "collection_products"  ("collection_id", "product_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_862459bc848778744e0370048d" ON "collection_products"  ("product_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e87d3f6a1fa89a197975d3fc52" ON "collection_products"  ("collection_id") `);
        await queryRunner.query(`CREATE TABLE "media" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "url" text NOT NULL, "alt" text, "width" integer, "height" integer, "mime_type" character varying(100), CONSTRAINT "PK_f4e0fcac36e050de337b670d8bd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "product_media" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" uuid NOT NULL, "media_id" uuid NOT NULL, "variant_id" uuid, "position" integer NOT NULL, CONSTRAINT "PK_09d4639de8082a32aa27f3ac9a6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9cd87ddf6e55e7eb21ca22901b" ON "product_media"  ("product_id", "media_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_b0895b1d84d747625a54b7fe9c" ON "product_media"  ("media_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e6bb4a69096db4f6a1f5bada15" ON "product_media"  ("product_id") `);
        await queryRunner.query(`CREATE TABLE "metafields" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "owner_type" character varying(30) NOT NULL, "owner_id" uuid NOT NULL, "namespace" character varying(60) NOT NULL, "key" character varying(60) NOT NULL, "type" character varying(30) NOT NULL, "value" text NOT NULL, CONSTRAINT "PK_7dadf771892b0f0772159b01306" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bb6048f679c4e5666210e7a5da" ON "metafields"  ("owner_type", "owner_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9aac99176496e79919fff3eaac" ON "metafields"  ("owner_type", "owner_id", "namespace", "key") `);
        await queryRunner.query(`CREATE TABLE "product_options" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "position" integer NOT NULL, CONSTRAINT "PK_3916b02fb43aa725f8167c718e4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ce204b236cc4bbb48774356628" ON "product_options"  ("product_id", "name") `);
        await queryRunner.query(`CREATE INDEX "IDX_49677f87ad61a8b2a31f33c8a2" ON "product_options"  ("product_id") `);
        await queryRunner.query(`CREATE TABLE "product_option_values" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "option_id" uuid NOT NULL, "value" character varying(255) NOT NULL, "position" integer NOT NULL, CONSTRAINT "PK_c5ddd425048b2df1a76cb9d5226" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ccdaa2c66e2c345ba54c66833a" ON "product_option_values"  ("option_id", "value") `);
        await queryRunner.query(`CREATE INDEX "IDX_7afee5fa03c1964f983632ca47" ON "product_option_values"  ("option_id") `);
        await queryRunner.query(`CREATE TABLE "variants" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, "product_id" uuid NOT NULL, "sku" character varying(120), "title" character varying(255) NOT NULL, "price" bigint NOT NULL, "compare_at_price" bigint, "weight_grams" integer, "barcode" character varying(120), "position" integer NOT NULL, "track_inventory" boolean NOT NULL DEFAULT true, "allow_backorder" boolean NOT NULL DEFAULT false, "option_value_ids" uuid array NOT NULL DEFAULT '{}', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "chk_variants_price_nonneg" CHECK ("price" >= 0), CONSTRAINT "PK_672d13d1a6de0197f20c6babb5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f28208ffe7f211453cd855d530" ON "variants"  ("sku") WHERE "sku" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_a9625f5484e6b6941d401ec101" ON "variants"  ("product_id") `);
        await queryRunner.query(`CREATE TABLE "inventory_adjustments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "variant_id" uuid NOT NULL, "location_id" uuid NOT NULL, "delta" integer NOT NULL, "reason" character varying(20) NOT NULL, "note" text, "actor_id" uuid, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_67a6cd67ec23f212ac3d124325e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_957d9a15c7ccdd3ece903c4e65" ON "inventory_adjustments"  ("variant_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "locations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, "name" character varying(255) NOT NULL, "is_default" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_7cc1c9e3853b94816c094825e74" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ad5d045e7fa74eeb2380a61805" ON "locations"  ("is_default") WHERE "is_default" = true`);
        await queryRunner.query(`CREATE TABLE "inventory_levels" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, "variant_id" uuid NOT NULL, "location_id" uuid NOT NULL, "on_hand" integer NOT NULL DEFAULT '0', "reserved" integer NOT NULL DEFAULT '0', CONSTRAINT "chk_inventory_reserved_range" CHECK ("reserved" >= 0 AND "reserved" <= "on_hand"), CONSTRAINT "chk_inventory_on_hand_nonneg" CHECK ("on_hand" >= 0), CONSTRAINT "PK_7d6c5977afc35996c6a42830d05" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8ff5ef6d0da89782d8a26214e4" ON "inventory_levels"  ("variant_id", "location_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_02a959d4c325d97f62f828e3ee" ON "inventory_levels"  ("location_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_9e8db73b806a5520d628d9124b" ON "inventory_levels"  ("variant_id") `);
        await queryRunner.query(`ALTER TABLE "collection_products" ADD CONSTRAINT "FK_e87d3f6a1fa89a197975d3fc527" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "collection_products" ADD CONSTRAINT "FK_862459bc848778744e0370048de" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_media" ADD CONSTRAINT "FK_e6bb4a69096db4f6a1f5bada151" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_media" ADD CONSTRAINT "FK_b0895b1d84d747625a54b7fe9cf" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_options" ADD CONSTRAINT "FK_49677f87ad61a8b2a31f33c8a2c" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_option_values" ADD CONSTRAINT "FK_7afee5fa03c1964f983632ca474" FOREIGN KEY ("option_id") REFERENCES "product_options"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "variants" ADD CONSTRAINT "FK_a9625f5484e6b6941d401ec101c" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory_levels" ADD CONSTRAINT "FK_9e8db73b806a5520d628d9124b3" FOREIGN KEY ("variant_id") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory_levels" ADD CONSTRAINT "FK_02a959d4c325d97f62f828e3eec" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        // GIN index for tag filters (`tags @> ARRAY[..]`); TypeORM has no decorator for it, so it lives here only
        await queryRunner.query(`CREATE INDEX "idx_products_tags_gin" ON "products" USING GIN ("tags")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_products_tags_gin"`);
        await queryRunner.query(`DROP TABLE "inventory_levels" CASCADE`);
        await queryRunner.query(`DROP TABLE "locations" CASCADE`);
        await queryRunner.query(`DROP TABLE "inventory_adjustments" CASCADE`);
        await queryRunner.query(`DROP TABLE "variants" CASCADE`);
        await queryRunner.query(`DROP TABLE "product_option_values" CASCADE`);
        await queryRunner.query(`DROP TABLE "product_options" CASCADE`);
        await queryRunner.query(`DROP TABLE "metafields" CASCADE`);
        await queryRunner.query(`DROP TABLE "product_media" CASCADE`);
        await queryRunner.query(`DROP TABLE "media" CASCADE`);
        await queryRunner.query(`DROP TABLE "collection_products" CASCADE`);
        await queryRunner.query(`DROP TABLE "products" CASCADE`);
        await queryRunner.query(`DROP TABLE "collections" CASCADE`);
    }

}
