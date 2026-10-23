import { MigrationInterface, QueryRunner } from "typeorm";

/** When the pending (not yet confirmed) 2FA secret was issued: /auth/2fa/setup reuses a recent one instead of rotating it on every call. */
export class StaffTotpSetupAt1790800000001 implements MigrationInterface {
    name = 'StaffTotpSetupAt1790800000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "staff_users" ADD "totp_setup_at" TIMESTAMP(3) WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "staff_users" DROP COLUMN "totp_setup_at"`);
    }
}
