import { MigrationInterface, QueryRunner } from "typeorm";

/** Temporary passwords (team invites, owner bootstrap) must be replaced at first login. Existing members are not forced. */
export class StaffMustChangePassword1790700000002 implements MigrationInterface {
    name = 'StaffMustChangePassword1790700000002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "staff_users" ADD "must_change_password" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "staff_users" DROP COLUMN "must_change_password"`);
    }
}
