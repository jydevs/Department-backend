import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { Clock } from "../common/clock/clock";
import { AppException } from "../common/errors/app-exception";
import { AuditService } from "../audit/audit.service";
import { anonymizedEmail, queryRows } from "./customers-support";

/**
 * Habeas Data erasure: the customer row stays (orders keep pointing at it) but every personal field is wiped.
 * Orders that are finished (completed / cancelled / expired) lose email, phone, addresses and notes while
 * keeping totals and lines for accounting; open or pending orders keep their delivery data until they close.
 */
@Injectable()
export class CustomerErasureService {
  constructor(
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Must run inside a transaction. Returns false when the customer was already anonymized. */
  async erase(manager: EntityManager, customerId: string, auditAction: string): Promise<boolean> {
    const now = this.clock.now();
    const email = anonymizedEmail(customerId);

    const rows = await queryRows<{ id: string }>(
      manager,
      `UPDATE customers
          SET email = $2, password_hash = NULL, first_name = 'Deleted', last_name = 'Customer', phone = NULL,
              accepts_marketing = false, marketing_consent_at = NULL, is_active = false,
              tags = '{}', internal_note = NULL, failed_login_count = 0, locked_until = NULL,
              anonymized_at = $3, version = version + 1
        WHERE id = $1 AND anonymized_at IS NULL
        RETURNING id`,
      [customerId, email, now],
    );
    if (rows.length === 0) return false;

    await manager.query("DELETE FROM customer_addresses WHERE customer_id = $1", [customerId]);
    await manager.query("DELETE FROM customer_tokens WHERE customer_id = $1", [customerId]);
    await manager.query(
      "UPDATE customer_refresh_tokens SET revoked_at = COALESCE(revoked_at, $2), ip = NULL, user_agent = NULL WHERE customer_id = $1",
      [customerId, now],
    );
    await manager.query(
      `UPDATE orders
          SET email = $2, phone = NULL, shipping_address = '{"anonymized":true}'::jsonb, billing_address = NULL,
              customer_note = NULL, internal_note = NULL, version = version + 1
        WHERE customer_id = $1 AND status IN ('completed', 'cancelled', 'expired')`,
      [customerId, email],
    );

    await this.audit.record({ action: auditAction, entityType: "Customer", entityId: customerId }, manager);
    return true;
  }

  /** Same as erase but a missing / already anonymized customer is a client error. */
  async eraseOrFail(manager: EntityManager, customerId: string, auditAction: string): Promise<void> {
    const done = await this.erase(manager, customerId, auditAction);
    if (!done) throw AppException.conflict("ALREADY_ANONYMIZED", "The customer is already anonymized");
  }
}
