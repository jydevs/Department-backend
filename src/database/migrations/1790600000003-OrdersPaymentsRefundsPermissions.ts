import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * `orders:payments` (mark-paid) and `orders:refunds` (refunds) are split from `orders:write`.
 * System roles owner and admin get them (RoleSyncService would also add them on boot); every other role,
 * including custom ones, keeps its permissions and must be granted the new ones explicitly (least privilege).
 */
export class OrdersPaymentsRefundsPermissions1790600000003 implements MigrationInterface {
    name = 'OrdersPaymentsRefundsPermissions1790600000003'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['orders:payments','orders:refunds']))
             WHERE "is_system" = true AND "key" IN ('owner','admin')`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "roles" SET "permissions" = array_remove(array_remove("permissions", 'orders:payments'), 'orders:refunds') WHERE "is_system" = true`,
        );
    }
}
