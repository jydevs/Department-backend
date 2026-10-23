import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { Clock } from "../common/clock/clock";
import { AppException } from "../common/errors/app-exception";
import { AuditService } from "../audit/audit.service";
import { anonymizedEmail, emailSuppressionHash, queryRows } from "./customers-support";

export const ANONYMIZE_ON_CLOSE_TAG = "anonymize-on-close";
const CLOSED_STATUSES = "('completed', 'cancelled', 'expired')";
const WIPE_ORDER = `email = $2, phone = NULL, shipping_address = '{"anonymized":true}'::jsonb, billing_address = NULL,
              customer_note = NULL, internal_note = NULL, tags = array_remove(tags, '${ANONYMIZE_ON_CLOSE_TAG}'), version = version + 1`;

/**
 * Habeas Data erasure: the customer row stays (orders keep pointing at it) but every personal field is wiped.
 * Orders that are finished (completed / cancelled / expired) lose email, phone, addresses and notes while
 * keeping totals and lines for accounting; open or pending orders keep their delivery data until they close and get
 * the `anonymize-on-close` tag: the Phase 8 maintenance service calls `anonymizeClosedTaggedOrders` to finish them.
 * Guest orders placed with the same e-mail (customer_id NULL) are treated exactly like the customer's own orders.
 */
@Injectable()
export class CustomerErasureService {
  constructor(
    private readonly clock: Clock,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Must run inside a transaction. Returns false when the customer was already anonymized. */
  async erase(manager: EntityManager, customerId: string, auditAction: string): Promise<boolean> {
    const now = this.clock.now();
    const email = anonymizedEmail(customerId);

    const current = await queryRows<{ email: string }>(manager, "SELECT email FROM customers WHERE id = $1 AND anonymized_at IS NULL FOR UPDATE", [customerId]);
    const originalEmail = current[0]?.email;
    if (!originalEmail) return false;

    await manager.query(
      `UPDATE customers
          SET email = $2, password_hash = NULL, first_name = 'Deleted', last_name = 'Customer', phone = NULL,
              accepts_marketing = false, marketing_consent_at = NULL, is_active = false,
              tags = '{}', internal_note = NULL, failed_login_count = 0, locked_until = NULL,
              anonymized_at = $3, version = version + 1
        WHERE id = $1`,
      [customerId, email, now],
    );

    await manager.query("DELETE FROM login_attempts WHERE scope = 'customer' AND account_id = $1", [customerId]);

    // remember only the hash of the erased address so imports / registrations cannot resurrect the data subject
    await manager.query("INSERT INTO erasure_suppressions (email_hash, created_at) VALUES ($1, $2) ON CONFLICT (email_hash) DO NOTHING", [
      emailSuppressionHash(originalEmail),
      now,
    ]);

    await manager.query("DELETE FROM customer_addresses WHERE customer_id = $1", [customerId]);
    await manager.query("DELETE FROM customer_tokens WHERE customer_id = $1", [customerId]);
    await manager.query(
      "UPDATE customer_refresh_tokens SET revoked_at = COALESCE(revoked_at, $2), ip = NULL, user_agent = NULL WHERE customer_id = $1",
      [customerId, now],
    );

    // own orders AND guest orders placed with the same e-mail: finished ones are wiped now, the rest are tagged for later
    const ownership = "(customer_id = $1 OR (customer_id IS NULL AND email = $3))";
    await manager.query(`UPDATE orders SET ${WIPE_ORDER} WHERE ${ownership} AND status IN ${CLOSED_STATUSES}`, [customerId, email, originalEmail]);
    await manager.query(
      `UPDATE orders SET tags = array_append(tags, '${ANONYMIZE_ON_CLOSE_TAG}'), version = version + 1
        WHERE (customer_id = $1 OR (customer_id IS NULL AND email = $2)) AND status NOT IN ${CLOSED_STATUSES}
          AND NOT ('${ANONYMIZE_ON_CLOSE_TAG}' = ANY(tags))`,
      [customerId, originalEmail],
    );

    // every other place the address lives
    await manager.query("DELETE FROM newsletter_subscribers WHERE email = $1", [originalEmail]);
    await manager.query("DELETE FROM contact_messages WHERE lower(email) = $1", [originalEmail]);
    await manager.query('DELETE FROM email_outbox WHERE "to" = $1', [originalEmail]);
    await manager.query("UPDATE discount_redemptions SET email = 'deleted' WHERE email = $1", [originalEmail]);

    await this.audit.record({ action: auditAction, entityType: "Customer", entityId: customerId }, manager);
    return true;
  }

  /**
   * Finishes the erasure of orders that were still open when their customer was erased: anonymizes up to `batch`
   * orders tagged `anonymize-on-close` whose status is now completed | cancelled | expired. Returns how many were done.
   * Called by the Phase 8 maintenance service (loop until it returns less than `batch`).
   */
  async anonymizeClosedTaggedOrders(batch: number): Promise<number> {
    const rows = await queryRows<{ id: string }>(
      this.dataSource,
      `UPDATE orders
          SET email = 'deleted+' || id::text || '@invalid', phone = NULL, shipping_address = '{"anonymized":true}'::jsonb, billing_address = NULL,
              customer_note = NULL, internal_note = NULL, tags = array_remove(tags, '${ANONYMIZE_ON_CLOSE_TAG}'), version = version + 1
        WHERE id IN (
          SELECT id FROM orders
           WHERE '${ANONYMIZE_ON_CLOSE_TAG}' = ANY(tags) AND status IN ${CLOSED_STATUSES}
           ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
        )
        RETURNING id`,
      [batch],
    );
    return rows.length;
  }

  /** Same as erase but a missing / already anonymized customer is a client error. */
  async eraseOrFail(manager: EntityManager, customerId: string, auditAction: string): Promise<void> {
    const done = await this.erase(manager, customerId, auditAction);
    if (!done) throw AppException.conflict("ALREADY_ANONYMIZED", "The customer is already anonymized");
  }
}
