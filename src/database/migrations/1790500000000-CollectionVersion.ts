import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Optimistic locking for collections (PATCH /admin/collections/:id accepts an optional `version`).
 * Existing rows start at version 1; the default is dropped afterwards so the schema matches the
 * `@VersionColumn` mapping (TypeORM sets the initial value itself on insert).
 */
export class CollectionVersion1790500000000 implements MigrationInterface {
    name = 'CollectionVersion1790500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "collections" ADD "version" integer NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "collections" ALTER COLUMN "version" DROP DEFAULT`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "collections" DROP COLUMN "version"`);
    }
}
