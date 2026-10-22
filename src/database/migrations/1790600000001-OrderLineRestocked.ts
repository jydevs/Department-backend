import { MigrationInterface, QueryRunner } from "typeorm";

/** Per-line count of units already put back into stock: a cancellation or a refund with restock can never restock the same unit twice. */
export class OrderLineRestocked1790600000001 implements MigrationInterface {
    name = 'OrderLineRestocked1790600000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order_lines" ADD "restocked_quantity" integer NOT NULL DEFAULT '0'`);
        // history: refunds that restocked
        await queryRunner.query(
            `UPDATE "order_lines" ol SET "restocked_quantity" = LEAST(ol."quantity", s.qty)
             FROM (SELECT rl.order_line_id, SUM(rl.quantity)::int AS qty
                   FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id
                   WHERE r.restocked = true GROUP BY rl.order_line_id) s
             WHERE s.order_line_id = ol.id`,
        );
        // history: cancellations of paid orders that restocked everything not yet restocked
        await queryRunner.query(
            `UPDATE "order_lines" ol SET "restocked_quantity" = ol."quantity"
             WHERE EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = ol.order_id AND e.type = 'order.cancelled'
                           AND e.data->>'restock' = 'true' AND e.data->>'wasPaid' = 'true')`,
        );
        await queryRunner.query(`ALTER TABLE "order_lines" ADD CONSTRAINT "chk_order_lines_restocked" CHECK ("restocked_quantity" BETWEEN 0 AND "quantity")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order_lines" DROP CONSTRAINT "chk_order_lines_restocked"`);
        await queryRunner.query(`ALTER TABLE "order_lines" DROP COLUMN "restocked_quantity"`);
    }
}
