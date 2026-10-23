import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Failed-login accounting per (account, IP): replaces the account-wide lock (5 failures from anyone locked the owner out).
 * `scope` = staff | customer; `account_id` is not a foreign key because it points at two different tables.
 * Old rows are purged by the hourly maintenance job.
 */
export class LoginAttempts1790700000001 implements MigrationInterface {
    name = 'LoginAttempts1790700000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "login_attempts" ("scope" character varying(10) NOT NULL, "account_id" uuid NOT NULL, "ip" character varying(64) NOT NULL, "fail_count" integer NOT NULL DEFAULT 0, "last_failure_at" TIMESTAMP(3) WITH TIME ZONE, "locked_until" TIMESTAMP(3) WITH TIME ZONE, "last_success_at" TIMESTAMP(3) WITH TIME ZONE, "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_login_attempts" PRIMARY KEY ("scope", "account_id", "ip"))`);
        await queryRunner.query(`CREATE INDEX "IDX_login_attempts_updated" ON "login_attempts" ("updated_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "login_attempts"`);
    }
}
