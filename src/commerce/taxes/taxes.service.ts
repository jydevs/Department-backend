import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import type { TaxSettingsDto, UpdateTaxInput } from "./taxes.dto";

interface TaxRow {
  id: string;
  prices_include_tax: boolean;
  rate_percent: string;
  label: string;
  updated_at: Date;
}

const toDto = (r: TaxRow): TaxSettingsDto => ({
  pricesIncludeTax: r.prices_include_tax,
  ratePercent: Number(r.rate_percent),
  label: r.label,
  updatedAt: r.updated_at,
});

@Injectable()
export class TaxesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<TaxSettingsDto> {
    const rows = await this.dataSource.query<TaxRow[]>(
      `SELECT id, prices_include_tax, rate_percent, label, updated_at FROM tax_settings ORDER BY created_at ASC LIMIT 1`,
    );
    // No row yet: report the documented defaults (the pricing engine falls back to the same values).
    return rows[0] ? toDto(rows[0]) : { pricesIncludeTax: true, ratePercent: 19, label: "IVA", updatedAt: null };
  }

  /** Single-row table: lock the row (or create it) so concurrent PUTs serialize. */
  async update(input: UpdateTaxInput): Promise<TaxSettingsDto> {
    return this.tx.run(async (manager) => {
      const current = await manager.query<TaxRow[]>(
        `SELECT id, prices_include_tax, rate_percent, label, updated_at FROM tax_settings ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
      );
      const before = current[0];
      const rows = before
        ? await manager.query<TaxRow[]>(
            `UPDATE tax_settings SET prices_include_tax = $2, rate_percent = $3, label = $4, updated_at = now()
             WHERE id = $1 RETURNING id, prices_include_tax, rate_percent, label, updated_at`,
            [before.id, input.pricesIncludeTax, input.ratePercent.toFixed(2), input.label],
          )
        : await manager.query<TaxRow[]>(
            `INSERT INTO tax_settings (id, prices_include_tax, rate_percent, label) VALUES ($1, $2, $3, $4)
             RETURNING id, prices_include_tax, rate_percent, label, updated_at`,
            [uuidv7(), input.pricesIncludeTax, input.ratePercent.toFixed(2), input.label],
          );
      const row = rows[0];
      if (!row) throw new Error("Tax settings write returned no row");
      await this.audit.record(
        {
          action: "tax_settings:update",
          entityType: "TaxSetting",
          entityId: row.id,
          diff: { before: before ? toDto(before) : null, after: toDto(row) },
        },
        manager,
      );
      return toDto(row);
    });
  }
}
