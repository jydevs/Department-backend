import { Injectable, Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { CustomerAddress } from "../customers/entities";
import { firstRow } from "../common/sql/query-result";
import { cell, normalizeEmail, normalizePhone, parseBool, tryNormalizePhone } from "./cell-parsers";
import {
  type BatchContext,
  type BatchOutcome,
  type Importer,
  type ImportRow,
  type ImportUnit,
  type PlanResult,
  type UnitOutcome,
  ImportRowException,
  emptyOutcome,
} from "./imports.types";
import type { ImportRowError } from "./entities/import-job.entity";

/** Tag put on every imported customer so the admin can find (and review) them. */
export const IMPORTED_CUSTOMER_TAG = "shopify-import";

interface ParsedAddress {
  fullName: string;
  phone: string;
  department: string;
  city: string;
  address1: string;
  postalCode: string | null;
  label: string | null;
}

interface ParsedCustomer {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  wantsMarketing: boolean;
  address: ParsedAddress | null;
}

interface ExistingCustomer {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  accepts_marketing: boolean;
  deleted_at: Date | null;
  anonymized_at: Date | null;
}

/**
 * Shopify "Customers" CSV export -> guest customers (password_hash NULL, email NOT verified).
 * They get an account through the storefront's forgot-password / register ("account exists") emails, whose
 * reset link sets a password and verifies the mailbox. Existing customers are never given a password or downgraded.
 */
@Injectable()
export class CustomerImporter implements Importer {
  private readonly logger = new Logger(CustomerImporter.name);
  readonly requiredColumns = ["email"] as const;

  plan(rows: ImportRow[]): PlanResult {
    const units: ImportUnit[] = [];
    const errors: ImportRowError[] = [];
    const seen = new Set<string>();
    let rejectedRows = 0;
    for (const row of rows) {
      const email = cell(row.cells.email).toLowerCase();
      if (email !== "" && seen.has(email)) {
        errors.push({ row: row.line, code: "DUPLICATE_IN_FILE", message: "Email: repeated in this file, row skipped" });
        rejectedRows++;
        continue;
      }
      seen.add(email);
      units.push({ line: row.line, rows: [row] });
    }
    return { units, errors, rejectedRows };
  }

  async processBatch(manager: EntityManager, units: ImportUnit[], ctx: BatchContext): Promise<BatchOutcome> {
    const out = emptyOutcome();
    for (const unit of units) {
      out.processedRows += unit.rows.length;
      try {
        const parsed = this.parse(unit.rows[0]);
        const outcome = await manager.transaction((m) => this.upsert(m, parsed, ctx)); // SAVEPOINT per customer
        out[outcome]++;
      } catch (err) {
        out.errorCount++;
        if (err instanceof ImportRowException) out.errors.push({ row: unit.line, code: err.code, message: err.message });
        else {
          this.logger.error(`Customer import failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
          out.errors.push({ row: unit.line, code: "INTERNAL_ERROR", message: "Unexpected error while saving this customer" });
        }
      }
    }
    return out;
  }

  private parse(row: ImportRow): ParsedCustomer {
    const c = row.cells;
    const email = normalizeEmail(c.email ?? "");
    const firstName = cell(c.firstname);
    const lastName = cell(c.lastname);
    if (firstName.length > 120 || lastName.length > 120) throw new ImportRowException("INVALID_NAME", "First Name / Last Name: at most 120 characters");
    const phone = normalizePhone(c.phone ?? "", "Phone");

    const marketing = cell(c.acceptsemailmarketing);
    const wantsMarketing = marketing === "" ? false : parseBool(marketing) === true; // only an explicit yes/true counts

    return { email, firstName, lastName, phone, wantsMarketing, address: this.parseAddress(c, firstName, lastName, phone) };
  }

  /** Optional: an incomplete or invalid default address is silently left out (never fails the row). */
  private parseAddress(c: Readonly<Record<string, string>>, firstName: string, lastName: string, customerPhone: string | null): ParsedAddress | null {
    const address1 = cell(c.defaultaddressaddress1);
    const city = cell(c.defaultaddresscity);
    const department = cell(c.defaultaddressprovince) || cell(c.defaultaddressprovincecode);
    const phone = tryNormalizePhone(c.defaultaddressphone ?? "") ?? customerPhone;
    const fullName = `${firstName} ${lastName}`.trim();
    const zip = cell(c.defaultaddresszip);
    const company = cell(c.defaultaddresscompany);
    if (address1 === "" || city === "" || department === "" || !phone || fullName === "") return null;
    if (address1.length > 200 || city.length > 80 || department.length > 60 || fullName.length > 120 || zip.length > 12) return null;
    return { fullName, phone, department, city, address1, postalCode: zip || null, label: company ? company.slice(0, 40) : null };
  }

  private async upsert(m: EntityManager, p: ParsedCustomer, ctx: BatchContext): Promise<UnitOutcome> {
    const existing = firstRow<ExistingCustomer>(
      await m.query(
        "SELECT id, first_name, last_name, phone, accepts_marketing, deleted_at, anonymized_at FROM customers WHERE email = $1 LIMIT 1 FOR UPDATE",
        [p.email],
      ),
    );

    if (!existing) {
      const inserted = firstRow<{ id: string }>(
        await m.query(
          `INSERT INTO customers (id, email, password_hash, first_name, last_name, phone, accepts_marketing, marketing_consent_at, tags, version)
           VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, ARRAY[$8]::text[], 1)
           ON CONFLICT (email) DO NOTHING RETURNING id`,
          [uuidv7(), p.email, p.firstName, p.lastName, p.phone, p.wantsMarketing, p.wantsMarketing ? ctx.now : null, IMPORTED_CUSTOMER_TAG],
        ),
      );
      if (!inserted) throw new ImportRowException("CONFLICT", "Another request created this customer at the same time");
      if (p.address) await this.addAddress(m, inserted.id, p.address);
      return "created";
    }

    if (existing.deleted_at || existing.anonymized_at) throw new ImportRowException("CUSTOMER_UNAVAILABLE", "Email: belongs to a deleted or anonymised customer");

    // Never touches password_hash, email verification, is_active or tags. Marketing can only be switched ON here.
    const firstName = p.firstName !== "" ? p.firstName : existing.first_name;
    const lastName = p.lastName !== "" ? p.lastName : existing.last_name;
    const phone = p.phone ?? existing.phone;
    const enableMarketing = p.wantsMarketing && !existing.accepts_marketing;
    const hasAddress = p.address
      ? firstRow<{ id: string }>(await m.query("SELECT id FROM customer_addresses WHERE customer_id = $1 LIMIT 1", [existing.id])) !== undefined
      : true;

    const changed = firstName !== existing.first_name || lastName !== existing.last_name || phone !== existing.phone || enableMarketing;
    if (changed) {
      await m.query(
        `UPDATE customers SET first_name = $2, last_name = $3, phone = $4,
                accepts_marketing = accepts_marketing OR $5, marketing_consent_at = CASE WHEN $5 THEN $6 ELSE marketing_consent_at END,
                updated_at = $6, version = version + 1
          WHERE id = $1`,
        [existing.id, firstName, lastName, phone, enableMarketing, ctx.now],
      );
    }
    if (p.address && !hasAddress) {
      await this.addAddress(m, existing.id, p.address);
      return "updated";
    }
    return changed ? "updated" : "skipped";
  }

  private async addAddress(m: EntityManager, customerId: string, a: ParsedAddress): Promise<void> {
    const address = new CustomerAddress();
    address.customerId = customerId;
    address.isDefault = true;
    address.label = a.label;
    address.fullName = a.fullName;
    address.phone = a.phone;
    address.department = a.department;
    address.city = a.city;
    address.address1 = a.address1;
    address.postalCode = a.postalCode;
    await m.getRepository(CustomerAddress).save(address);
  }
}
