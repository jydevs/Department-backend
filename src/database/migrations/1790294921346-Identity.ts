import { MigrationInterface, QueryRunner } from "typeorm";

export class Identity1790294921346 implements MigrationInterface {
    name = 'Identity1790294921346'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "actor_type" character varying(20) NOT NULL, "actor_id" uuid, "action" character varying(80) NOT NULL, "entity_type" character varying(60) NOT NULL, "entity_id" character varying(64), "diff" jsonb, "request_id" character varying(100), "ip" character varying(45), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4a85d553dbb4006bd350ab6f88" ON "audit_logs"  ("actor_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_7421efc125d95e413657efa3c6" ON "audit_logs"  ("entity_type", "entity_id") `);
        await queryRunner.query(`CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "key" character varying(40) NOT NULL, "name" character varying(255) NOT NULL, "permissions" text array NOT NULL DEFAULT '{}', "is_system" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_a87cf0659c3ac379b339acf36a2" UNIQUE ("key"), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "staff_users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, "email" character varying(255) NOT NULL, "password_hash" text NOT NULL, "full_name" character varying(255) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "role_id" uuid NOT NULL, "totp_secret_enc" text, "totp_enabled" boolean NOT NULL DEFAULT false, "recovery_codes_hash" text array NOT NULL DEFAULT '{}', "failed_login_count" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP(3) WITH TIME ZONE, "last_login_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "PK_c6b167335377df69f7910c2c75e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9004736d4a5981c3f8386d9882" ON "staff_users"  ("role_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4f32dd66546226ea64f5573b77" ON "staff_users"  ("email") `);
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "staff_user_id" uuid NOT NULL, "family_id" uuid NOT NULL, "token_hash" character(64) NOT NULL, "expires_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP(3) WITH TIME ZONE, "replaced_by_id" uuid, "user_agent" character varying(300), "ip" character varying(45), CONSTRAINT "UQ_a7838d2ba25be1342091b6695f1" UNIQUE ("token_hash"), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d5e27da0cd39bc3bb2811fc8ba" ON "refresh_tokens"  ("family_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_90cf30dd54c7539370fc876bee" ON "refresh_tokens"  ("staff_user_id") `);
        await queryRunner.query(`ALTER TABLE "staff_users" ADD CONSTRAINT "FK_9004736d4a5981c3f8386d98821" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_90cf30dd54c7539370fc876beea" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_90cf30dd54c7539370fc876beea"`);
        await queryRunner.query(`ALTER TABLE "staff_users" DROP CONSTRAINT "FK_9004736d4a5981c3f8386d98821"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_90cf30dd54c7539370fc876bee"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d5e27da0cd39bc3bb2811fc8ba"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4f32dd66546226ea64f5573b77"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9004736d4a5981c3f8386d9882"`);
        await queryRunner.query(`DROP TABLE "staff_users"`);
        await queryRunner.query(`DROP TABLE "roles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7421efc125d95e413657efa3c6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4a85d553dbb4006bd350ab6f88"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
    }

}
