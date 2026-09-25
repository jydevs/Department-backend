import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Clock } from "../common/clock/clock";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { MAIL_TRANSPORT, type MailTransport } from "./mail.transport";

const INTERVAL_MS = 15_000;
const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 60_000;
/** A claimed row is invisible to other workers for this long; if this process dies mid-send it is retried afterwards. */
const LEASE_MS = 2 * 60_000;
/** Bodies of these mails carry one-time links: once delivered they are wiped from the outbox (subject and metadata stay). */
export const SENSITIVE_TEMPLATES: readonly string[] = ["password_reset", "email_verify", "newsletter_confirm", "account_exists"];

interface ClaimedRow {
  id: string;
  to: string;
  template: string;
  subject: string;
  body_html: string;
  body_text: string;
  attempts: number;
}

/** Delivers email_outbox rows. Safe with several instances (FOR UPDATE SKIP LOCKED claim). One failure never aborts the batch. */
@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === "test" && process.env.MAIL_WORKER_ENABLED === "false") return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.claim();
      for (const row of rows) await this.deliver(row);
    } catch (err) {
      this.logger.error(`Mail worker tick failed: ${errorMessage(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** Atomically pick due rows and push their send_after into the future (lease) in one short statement. */
  private async claim(): Promise<ClaimedRow[]> {
    const now = this.clock.now();
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    // CTE + SELECT so TypeORM returns plain rows (a bare UPDATE ... RETURNING comes back as [rows, count]).
    const rows: ClaimedRow[] = await this.dataSource.query(
      `WITH claimed AS (
         UPDATE email_outbox SET send_after = $1, updated_at = $2
         WHERE id IN (
           SELECT id FROM email_outbox
           WHERE status = 'pending' AND send_after <= $2
           ORDER BY send_after, id
           LIMIT ${BATCH_SIZE}
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, "to", template, subject, body_html, body_text, attempts
       ) SELECT * FROM claimed`,
      [leaseUntil, now],
    );
    return rows;
  }

  private async deliver(row: ClaimedRow): Promise<void> {
    try {
      await this.transport.send({ to: row.to, subject: row.subject, html: row.body_html, text: row.body_text });
      const now = this.clock.now();
      await this.dataSource.query(
        `UPDATE email_outbox
            SET status = 'sent', sent_at = $2, attempts = attempts + 1, last_error = NULL, updated_at = $2,
                body_html = CASE WHEN $3 THEN '' ELSE body_html END, body_text = CASE WHEN $3 THEN '' ELSE body_text END
          WHERE id = $1`,
        [row.id, now, SENSITIVE_TEMPLATES.includes(row.template)],
      );
    } catch (err) {
      await this.fail(row, err);
    }
  }

  private async fail(row: ClaimedRow, err: unknown): Promise<void> {
    const attempts = row.attempts + 1;
    const now = this.clock.now();
    const exhausted = attempts >= MAX_ATTEMPTS;
    const retryAt = new Date(now.getTime() + BASE_BACKOFF_MS * 2 ** (attempts - 1));
    this.logger.warn(`Mail ${row.id} attempt ${attempts}/${MAX_ATTEMPTS} failed: ${errorMessage(err)}`);
    try {
      await this.dataSource.query(
        `UPDATE email_outbox SET status = $2, attempts = $3, last_error = $4, send_after = $5, updated_at = $6 WHERE id = $1`,
        [row.id, exhausted ? "failed" : "pending", attempts, errorMessage(err).slice(0, 1000), exhausted ? now : retryAt, now],
      );
    } catch (dbErr) {
      this.logger.error(`Could not record failure of mail ${row.id}: ${errorMessage(dbErr)}`);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
