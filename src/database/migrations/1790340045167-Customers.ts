import { MigrationInterface, QueryRunner } from "typeorm";

export class Customers1790340045167 implements MigrationInterface {
    name = 'Customers1790340045167'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "customers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL, "email" character varying(255) NOT NULL, "password_hash" text, "first_name" character varying(120) NOT NULL, "last_name" character varying(120) NOT NULL, "phone" character varying(30), "accepts_marketing" boolean NOT NULL DEFAULT false, "marketing_consent_at" TIMESTAMP(3) WITH TIME ZONE, "is_active" boolean NOT NULL DEFAULT true, "email_verified_at" TIMESTAMP(3) WITH TIME ZONE, "failed_login_count" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP(3) WITH TIME ZONE, "last_login_at" TIMESTAMP(3) WITH TIME ZONE, "tags" text array NOT NULL DEFAULT '{}', "internal_note" text, "anonymized_at" TIMESTAMP(3) WITH TIME ZONE, "deleted_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e2c8c9d96c60024ca6cf15a4e3" ON "customers"  ("accepts_marketing") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8536b8b85c06969f84f0c098b0" ON "customers"  ("email") `);
        await queryRunner.query(`CREATE TABLE "customer_addresses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "customer_id" uuid NOT NULL, "label" character varying(40), "is_default" boolean NOT NULL DEFAULT false, "full_name" character varying(120) NOT NULL, "phone" character varying(30) NOT NULL, "department" character varying(60) NOT NULL, "city" character varying(80) NOT NULL, "address1" character varying(200) NOT NULL, "address2" character varying(200), "postal_code" character varying(12), "document_type" character varying(4), "document_number" character varying(20), CONSTRAINT "PK_336bda7b0a0cd04241f719fc834" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6be4e1a698f5c3f2c2e4c75c18" ON "customer_addresses"  ("customer_id") `);
        await queryRunner.query(`CREATE TABLE "customer_refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "customer_id" uuid NOT NULL, "family_id" uuid NOT NULL, "token_hash" character(64) NOT NULL, "expires_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP(3) WITH TIME ZONE, "replaced_by_id" uuid, "user_agent" character varying(300), "ip" character varying(45), CONSTRAINT "UQ_db450cd4bbe1b7ca4c36762c777" UNIQUE ("token_hash"), CONSTRAINT "PK_a0872102f2c477ecc4264a1bc93" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8a4cb496b129f22e9383798fec" ON "customer_refresh_tokens"  ("family_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_64ee8c9d54275883c6068e70a1" ON "customer_refresh_tokens"  ("customer_id") `);
        await queryRunner.query(`CREATE TABLE "customer_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "customer_id" uuid NOT NULL, "type" character varying(20) NOT NULL, "token_hash" character(64) NOT NULL, "expires_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "UQ_1bf59c23cb1086066c97c05cea6" UNIQUE ("token_hash"), CONSTRAINT "chk_customer_tokens_type" CHECK ("type" IN ('password_reset','email_verify')), CONSTRAINT "PK_82085a2a1850e02d40a965306ba" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_25c0ac65ba6a2d25b7d311b34a" ON "customer_tokens"  ("customer_id", "type") `);
        await queryRunner.query(`CREATE TABLE "email_outbox" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "to" character varying(255) NOT NULL, "template" character varying(60) NOT NULL, "subject" character varying(255) NOT NULL, "body_html" text NOT NULL, "body_text" text NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "send_after" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "sent_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "chk_email_outbox_attempts_nonneg" CHECK ("attempts" >= 0), CONSTRAINT "chk_email_outbox_status" CHECK ("status" IN ('pending','sent','failed')), CONSTRAINT "PK_b6fbfc201f705fbf1ac87bd7197" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1ba86c8dcdf345e9356a45da0c" ON "email_outbox"  ("status", "send_after") `);
        await queryRunner.query(`CREATE TABLE "contact_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "email" character varying(255) NOT NULL, "subject" character varying(200), "message" character varying(4000) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'new', "ip" character varying(45), CONSTRAINT "chk_contact_messages_status" CHECK ("status" IN ('new','read','replied','spam')), CONSTRAINT "PK_b74f96eb2edd977ccfba6533293" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_08263816f6f0f3075849228c82" ON "contact_messages"  ("status", "created_at") `);
        await queryRunner.query(`CREATE TABLE "email_templates" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "key" character varying(60) NOT NULL, "subject" character varying(255) NOT NULL, "body_html" text NOT NULL, "body_text" text NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_06c564c515d8cdb40b6f3bfbbb4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b85e02f9cb9961804a773723bb" ON "email_templates"  ("key") `);
        await queryRunner.query(`CREATE TABLE "newsletter_subscribers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "email" character varying(255) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending', "source" character varying(40) NOT NULL, "consent_at" TIMESTAMP(3) WITH TIME ZONE, "confirm_token_hash" character(64), "unsubscribe_token_hash" character(64), "ip" character varying(45), CONSTRAINT "chk_newsletter_status" CHECK ("status" IN ('pending','subscribed','unsubscribed')), CONSTRAINT "PK_38f9333e9961b2fdb589128d19b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e6defa922c49c6173b1734bc21" ON "newsletter_subscribers"  ("unsubscribe_token_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_185083992227953420d078ee20" ON "newsletter_subscribers"  ("confirm_token_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_31db80a01fe1bf199796eb2073" ON "newsletter_subscribers"  ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0dc48416511f011f7de7b2a8f8" ON "newsletter_subscribers"  ("email") `);
        await queryRunner.query(`CREATE INDEX "IDX_a8fcf679692db1c886e7f15d2b" ON "customers"  ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_772d0ce0473ac2ccfa26060dbe" ON "orders"  ("customer_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_952f070ca31b95def7ecfcdb89" ON "orders"  ("paid_at") `);
        await queryRunner.query(`ALTER TABLE "tax_settings" ALTER COLUMN "rate_percent" SET DEFAULT '19.00'`);
        await queryRunner.query(`ALTER TABLE "customer_addresses" ADD CONSTRAINT "FK_6be4e1a698f5c3f2c2e4c75c186" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_refresh_tokens" ADD CONSTRAINT "FK_64ee8c9d54275883c6068e70a12" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_tokens" ADD CONSTRAINT "FK_603f63d478610e2c71e15dffc57" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_952f070ca31b95def7ecfcdb89"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_772d0ce0473ac2ccfa26060dbe"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_a8fcf679692db1c886e7f15d2b"`);
        await queryRunner.query(`ALTER TABLE "customer_tokens" DROP CONSTRAINT "FK_603f63d478610e2c71e15dffc57"`);
        await queryRunner.query(`ALTER TABLE "customer_refresh_tokens" DROP CONSTRAINT "FK_64ee8c9d54275883c6068e70a12"`);
        await queryRunner.query(`ALTER TABLE "customer_addresses" DROP CONSTRAINT "FK_6be4e1a698f5c3f2c2e4c75c186"`);
        await queryRunner.query(`ALTER TABLE "tax_settings" ALTER COLUMN "rate_percent" SET DEFAULT 19.00`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0dc48416511f011f7de7b2a8f8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_31db80a01fe1bf199796eb2073"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_185083992227953420d078ee20"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e6defa922c49c6173b1734bc21"`);
        await queryRunner.query(`DROP TABLE "newsletter_subscribers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b85e02f9cb9961804a773723bb"`);
        await queryRunner.query(`DROP TABLE "email_templates"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_08263816f6f0f3075849228c82"`);
        await queryRunner.query(`DROP TABLE "contact_messages"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1ba86c8dcdf345e9356a45da0c"`);
        await queryRunner.query(`DROP TABLE "email_outbox"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_25c0ac65ba6a2d25b7d311b34a"`);
        await queryRunner.query(`DROP TABLE "customer_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_64ee8c9d54275883c6068e70a1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8a4cb496b129f22e9383798fec"`);
        await queryRunner.query(`DROP TABLE "customer_refresh_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6be4e1a698f5c3f2c2e4c75c18"`);
        await queryRunner.query(`DROP TABLE "customer_addresses"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8536b8b85c06969f84f0c098b0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e2c8c9d96c60024ca6cf15a4e3"`);
        await queryRunner.query(`DROP TABLE "customers"`);
    }

}
