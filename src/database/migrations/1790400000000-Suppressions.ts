import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Security review fixes: Habeas Data suppression list (M-2) and order_lines column lengths aligned with the
 * catalog (L-3: variants.sku is 120 chars, imported image URLs may be 2000).
 */
export class Suppressions1790400000000 implements MigrationInterface {
    name = 'Suppressions1790400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "erasure_suppressions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email_hash" character(64) NOT NULL, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_erasure_suppressions_email_hash" UNIQUE ("email_hash"), CONSTRAINT "PK_erasure_suppressions_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "order_lines" ALTER COLUMN "sku" TYPE character varying(120)`);
        await queryRunner.query(`ALTER TABLE "order_lines" ALTER COLUMN "image_url" TYPE character varying(2000)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE "order_lines" SET "image_url" = left("image_url", 1000), "sku" = left("sku", 100)`);
        await queryRunner.query(`ALTER TABLE "order_lines" ALTER COLUMN "image_url" TYPE character varying(1000)`);
        await queryRunner.query(`ALTER TABLE "order_lines" ALTER COLUMN "sku" TYPE character varying(100)`);
        await queryRunner.query(`DROP TABLE "erasure_suppressions"`);
    }

}
