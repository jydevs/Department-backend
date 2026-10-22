import { MigrationInterface, QueryRunner } from "typeorm";

/** Tokens (hashed) for the order links sent by e-mail, so guests can open their order without the checkout token. */
export class OrderAccessTokens1790600000005 implements MigrationInterface {
    name = 'OrderAccessTokens1790600000005'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "order_access_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "kind" character varying(20) NOT NULL DEFAULT 'mail', "expires_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, CONSTRAINT "PK_order_access_tokens" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_order_access_tokens_hash" ON "order_access_tokens" ("token_hash")`);
        await queryRunner.query(`CREATE INDEX "IDX_order_access_tokens_order" ON "order_access_tokens" ("order_id")`);
        await queryRunner.query(`ALTER TABLE "order_access_tokens" ADD CONSTRAINT "FK_order_access_tokens_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "order_access_tokens"`);
    }
}
