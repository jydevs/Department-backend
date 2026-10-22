import { MigrationInterface, QueryRunner } from "typeorm";

/** Last accepted TOTP time step per staff user: a code (30 s) can be used only once, in login and in 2fa/disable. */
export class StaffTotpLastStep1790600000002 implements MigrationInterface {
    name = 'StaffTotpLastStep1790600000002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "staff_users" ADD "totp_last_step" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "staff_users" DROP COLUMN "totp_last_step"`);
    }
}
