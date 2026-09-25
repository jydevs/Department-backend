import { MigrationInterface, QueryRunner } from "typeorm";

export class Cms1790337876382 implements MigrationInterface {
    name = 'Cms1790337876382'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "content_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, "kind" character varying(20) NOT NULL, "key" character varying(120) NOT NULL, "title" character varying(255), "draft" jsonb NOT NULL, "published_version_id" uuid, "draft_updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, "draft_updated_by" uuid, "deleted_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "PK_b5965ff0759fae6148a410bd713" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_content_documents_kind_key" ON "content_documents"  ("kind", "key") WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "content_versions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "document_id" uuid NOT NULL, "number" integer NOT NULL, "data" jsonb NOT NULL, "status" character varying(12) NOT NULL, "publish_at" TIMESTAMP(3) WITH TIME ZONE, "published_at" TIMESTAMP(3) WITH TIME ZONE, "superseded_at" TIMESTAMP(3) WITH TIME ZONE, "author_id" uuid, "note" character varying(255), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_77046b137eb8001947fc332e594" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_content_versions_scheduled" ON "content_versions"  ("publish_at") WHERE "status" = 'scheduled'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_content_versions_document_number" ON "content_versions"  ("document_id", "number") `);
        await queryRunner.query(`CREATE TABLE "redirects" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "from_path" character varying(500) NOT NULL, "to_path" character varying(1000) NOT NULL, "status_code" smallint NOT NULL DEFAULT '301', "is_active" boolean NOT NULL DEFAULT true, "hits" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_d81f0797728eb0eb92ae3c6eedd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_redirects_from_path" ON "redirects"  ("from_path") `);
        await queryRunner.query(`ALTER TABLE "media" ADD "storage_key" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "media" ADD "byte_size" integer`);
        await queryRunner.query(`ALTER TABLE "media" ADD "original_name" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "media" ADD "sha256" character(64)`);
        await queryRunner.query(`ALTER TABLE "media" ADD "uploaded_by" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_a459f2e49c923a3f7f60532f8f" ON "media"  ("sha256") `);
        await queryRunner.query(`ALTER TABLE "content_versions" ADD CONSTRAINT "FK_6de938229e90d5fcd82fc261b65" FOREIGN KEY ("document_id") REFERENCES "content_documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_a459f2e49c923a3f7f60532f8f"`);
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
