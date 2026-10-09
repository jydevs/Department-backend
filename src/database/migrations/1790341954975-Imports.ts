import { MigrationInterface, QueryRunner } from "typeorm";

export class Imports1790341954975 implements MigrationInterface {
    name = 'Imports1790341954975'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "import_jobs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, "type" character varying(20) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'queued', "dry_run" boolean NOT NULL DEFAULT false, "file_name" character varying(255) NOT NULL, "file_sha256" character(64) NOT NULL, "total_rows" integer NOT NULL DEFAULT '0', "processed_rows" integer NOT NULL DEFAULT '0', "created_count" integer NOT NULL DEFAULT '0', "updated_count" integer NOT NULL DEFAULT '0', "skipped_count" integer NOT NULL DEFAULT '0', "error_count" integer NOT NULL DEFAULT '0', "errors" jsonb NOT NULL DEFAULT '[]', "started_at" TIMESTAMP(3) WITH TIME ZONE, "finished_at" TIMESTAMP(3) WITH TIME ZONE, "created_by" uuid, CONSTRAINT "chk_import_jobs_type" CHECK ("type" IN ('products','customers')), CONSTRAINT "chk_import_jobs_status" CHECK ("status" IN ('queued','running','done','failed','cancelled')), CONSTRAINT "PK_4d206c602f173f98e4bb85819a3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_import_jobs_status_created" ON "import_jobs"  ("status", "created_at") `);
        await queryRunner.query(`ALTER TABLE "tax_settings" ALTER COLUMN "rate_percent" SET DEFAULT '19.00'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tax_settings" ALTER COLUMN "rate_percent" SET DEFAULT 19.00`);
        await queryRunner.query(`DROP INDEX "public"."idx_import_jobs_status_created"`);
        await queryRunner.query(`DROP TABLE "import_jobs"`);
    }

}
