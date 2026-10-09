import { MigrationInterface, QueryRunner } from "typeorm";

export class Cms1790337876382 implements MigrationInterface {
    name = 'Cms1790337876382'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "content_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, "kind" character varying(20) NOT NULL, "key" character varying(120) NOT NULL, "title" character varying(255), "draft" jsonb NOT NULL, "published_version_id" uuid, "draft_updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, "draft_updated_by" uuid, "deleted_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "PK_b5965ff0759fae6148a410bd713" PRIMARY KEY ("id"), CONSTRAINT "chk_content_documents_kind" CHECK ("kind" IN ('settings','menu','template','page')))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_content_documents_kind_key" ON "content_documents"  ("kind", "key") WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "content_versions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "document_id" uuid NOT NULL, "number" integer NOT NULL, "title" character varying(255), "data" jsonb NOT NULL, "status" character varying(12) NOT NULL, "publish_at" TIMESTAMP(3) WITH TIME ZONE, "published_at" TIMESTAMP(3) WITH TIME ZONE, "superseded_at" TIMESTAMP(3) WITH TIME ZONE, "author_id" uuid, "note" character varying(255), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_77046b137eb8001947fc332e594" PRIMARY KEY ("id"), CONSTRAINT "chk_content_versions_status" CHECK ("status" IN ('published','scheduled','superseded','cancelled')))`);
        await queryRunner.query(`CREATE INDEX "idx_content_versions_scheduled" ON "content_versions"  ("publish_at") WHERE "status" = 'scheduled'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_content_versions_document_number" ON "content_versions"  ("document_id", "number") `);
        await queryRunner.query(`CREATE TABLE "redirects" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "from_path" character varying(500) NOT NULL, "to_path" character varying(1000) NOT NULL, "status_code" smallint NOT NULL DEFAULT '301', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_d81f0797728eb0eb92ae3c6eedd" PRIMARY KEY ("id"), CONSTRAINT "chk_redirects_status_code" CHECK ("status_code" IN (301, 302)))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_redirects_from_path" ON "redirects"  ("from_path") `);
        await queryRunner.query(`ALTER TABLE "media" ADD "storage_key" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "media" ADD "byte_size" integer`);
        await queryRunner.query(`ALTER TABLE "media" ADD "original_name" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "media" ADD "sha256" character(64)`);
        await queryRunner.query(`ALTER TABLE "media" ADD "uploaded_by" uuid`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_media_sha256" ON "media"  ("sha256") WHERE "sha256" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "content_versions" ADD CONSTRAINT "FK_6de938229e90d5fcd82fc261b65" FOREIGN KEY ("document_id") REFERENCES "content_documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "content_documents" ADD CONSTRAINT "FK_9cbd2833d9711b0969a3b38ff65" FOREIGN KEY ("published_version_id") REFERENCES "content_versions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "content_documents" DROP CONSTRAINT IF EXISTS "FK_9cbd2833d9711b0969a3b38ff65"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "uq_media_sha256"`);
        await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "uploaded_by"`);
        await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "sha256"`);
        await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "original_name"`);
        await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "byte_size"`);
        await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "storage_key"`);
        await queryRunner.query(`DROP TABLE "redirects" CASCADE`);
        await queryRunner.query(`DROP TABLE "content_versions" CASCADE`);
        await queryRunner.query(`DROP TABLE "content_documents" CASCADE`);
    }

}
