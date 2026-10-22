import { MigrationInterface, QueryRunner } from "typeorm";

/** Optional phone number on the public contact form (POST /storefront/contact). */
export class ContactPhone1790500000001 implements MigrationInterface {
    name = 'ContactPhone1790500000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact_messages" ADD "phone" character varying(30)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact_messages" DROP COLUMN "phone"`);
    }
}
