import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Variants that track inventory AND allow backorder now decrement on_hand when an order is paid, so on_hand may go below zero
 * (units owed to customers). `reserved` stays >= 0 and is capped by the positive part of on_hand.
 */
export class InventoryBackorderNegative1790600000004 implements MigrationInterface {
    name = 'InventoryBackorderNegative1790600000004'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "inventory_levels" DROP CONSTRAINT "chk_inventory_on_hand_nonneg"`);
        await queryRunner.query(`ALTER TABLE "inventory_levels" DROP CONSTRAINT "chk_inventory_reserved_range"`);
        await queryRunner.query(`ALTER TABLE "inventory_levels" ADD CONSTRAINT "chk_inventory_reserved_range" CHECK ("reserved" >= 0 AND "reserved" <= GREATEST("on_hand", 0))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE "inventory_levels" SET "on_hand" = 0 WHERE "on_hand" < 0`);
        await queryRunner.query(`ALTER TABLE "inventory_levels" DROP CONSTRAINT "chk_inventory_reserved_range"`);
        await queryRunner.query(`ALTER TABLE "inventory_levels" ADD CONSTRAINT "chk_inventory_reserved_range" CHECK ("reserved" >= 0 AND "reserved" <= "on_hand")`);
        await queryRunner.query(`ALTER TABLE "inventory_levels" ADD CONSTRAINT "chk_inventory_on_hand_nonneg" CHECK ("on_hand" >= 0)`);
    }
}
