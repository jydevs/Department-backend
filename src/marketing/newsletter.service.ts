import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, Repository } from "typeorm";
import { AuditService } from "../audit/audit.service";
import { Clock } from "../common/clock/clock";
import { RequestContextStore } from "../common/context/request-context";
import { AppException } from "../common/errors/app-exception";
import { OffsetPage, toOffsetPage } from "../common/pagination/pagination";
import { escapeLike } from "../common/sql/escape-like";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { TransactionService } from "../database/transaction.service";
import { MailService } from "../mail/mail.service";
import { truncateIp } from "./ip-truncate";
import type { NewsletterListQueryDto, NewsletterSubscriberResponse, NewsletterTokenResponse } from "./marketing.dto";
import { NewsletterSubscriber } from "./entities";

const CONFIRM_TTL_MS = 7 * 24 * 3600_000;
/** Do not re-send a confirmation mail more often than this for the same pending address (anti mail-bombing). */
const RESEND_COOLDOWN_MS = 2 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const newToken = (): { raw: string; hash: string } => {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256(raw) };
};
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);
  /** HMAC('newsletter-unsubscribe', CUSTOMER_JWT_SECRET); a random per-process secret in dev when none is configured. */
  private readonly unsubscribeKey: Buffer;

  constructor(
    @InjectRepository(NewsletterSubscriber) private readonly subscribers: Repository<NewsletterSubscriber>,
    private readonly tx: TransactionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {
    const secret = this.env.CUSTOMER_JWT_SECRET ? Buffer.from(this.env.CUSTOMER_JWT_SECRET, "utf8") : randomBytes(32);
    this.unsubscribeKey = createHmac("sha256", secret).update("newsletter-unsubscribe").digest();
  }

  /**
   * Stateless one-click unsubscribe token: `<subscriber id>.<HMAC-SHA256(id)>`. Nothing is stored (the legacy
   * unsubscribe_token_hash column stays in the schema but is no longer used), it never expires and it is reusable.
   */
  unsubscribeToken(subscriberId: string): string {
    return `${subscriberId}.${createHmac("sha256", this.unsubscribeKey).update(subscriberId).digest("base64url")}`;
  }

  unsubscribeUrl(subscriberId: string): string {
    return this.link("baja", this.unsubscribeToken(subscriberId));
  }

  /** Returns the subscriber id when the token is authentic, otherwise null. */
  private verifyUnsubscribeToken(token: string): string | null {
    const dot = token.indexOf(".");
    if (dot !== 36) return null;
    const id = token.slice(0, dot);
    if (!UUID.test(id)) return null;
    const expected = Buffer.from(this.unsubscribeToken(id));
    const given = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
  }

  /**
   * Answers immediately; the insert and the mail happen right after the response, so timing does not tell whether
   * the address was already known. Failures are logged, never surfaced.
   */
  subscribe(email: string, source: string): void {
    const ip = truncateIp(RequestContextStore.get()?.ip);
    setImmediate(() => {
      this.performSubscribe(email, source, ip).catch((err: unknown) =>
        this.logger.error(`subscribe failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    });
  }

  private async performSubscribe(email: string, source: string, ip: string | null): Promise<void> {
    const now = this.clock.now();
    await this.tx.run(async (manager) => {
      await manager
        .createQueryBuilder()
        .insert()
        .into(NewsletterSubscriber)
        .values({ email, status: "pending", source, ip })
        .orIgnore()
        .execute();
      const row = await manager.findOne(NewsletterSubscriber, { where: { email }, lock: { mode: "pessimistic_write" } });
      if (!row || row.status === "subscribed") return;

      // A pending row that already got its confirmation token was mailed recently: do not re-send yet.
      const alreadyMailed = row.confirmTokenHash !== null && row.confirmTokenHash !== undefined;
      if (row.status === "pending" && alreadyMailed && now.getTime() - row.updatedAt.getTime() < RESEND_COOLDOWN_MS) return;

      const confirm = newToken();
      row.status = "pending";
      row.confirmTokenHash = confirm.hash;
      row.source = row.source || source;
      row.ip = ip;
      await manager.save(row);
      await this.mail.enqueue(
        {
          to: email,
          template: "newsletter_confirm",
          data: { confirmUrl: this.link("confirmar", confirm.raw), unsubscribeUrl: this.unsubscribeUrl(row.id) },
        },
        manager,
      );
    });
  }

  async confirm(token: string): Promise<NewsletterTokenResponse> {
    const now = this.clock.now();
    return this.tx.run(async (manager) => {
      const row = await manager.findOne(NewsletterSubscriber, {
        where: { confirmTokenHash: sha256(token) },
        lock: { mode: "pessimistic_write" },
      });
      if (!row || row.status !== "pending" || now.getTime() - row.updatedAt.getTime() > CONFIRM_TTL_MS) {
        throw AppException.badRequest("INVALID_TOKEN", "The link is invalid or has expired");
      }
      row.status = "subscribed";
      row.consentAt = now;
      row.confirmTokenHash = null;
      await manager.save(row);
      return { status: "subscribed" as const };
    });
  }

  async unsubscribeByToken(token: string): Promise<NewsletterTokenResponse> {
    const id = this.verifyUnsubscribeToken(token);
    if (!id) throw AppException.badRequest("INVALID_TOKEN", "The link is invalid");
    return this.tx.run(async (manager) => {
      const row = await manager.findOne(NewsletterSubscriber, { where: { id }, lock: { mode: "pessimistic_write" } });
      if (!row) throw AppException.badRequest("INVALID_TOKEN", "The link is invalid");
      if (row.status !== "unsubscribed") {
        row.status = "unsubscribed";
        row.confirmTokenHash = null;
        await manager.save(row);
      }
      return { status: "unsubscribed" as const };
    });
  }

  /* ── admin ── */

  async list(query: NewsletterListQueryDto): Promise<OffsetPage<NewsletterSubscriberResponse>> {
    const qb = this.subscribers.createQueryBuilder("s");
    if (query.status) qb.andWhere("s.status = :status", { status: query.status });
    if (query.q) qb.andWhere("s.email ILIKE :q ESCAPE '\\'", { q: `%${escapeLike(query.q)}%` });
    const [rows, total] = await qb
      .orderBy("s.createdAt", "DESC")
      .addOrderBy("s.id", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return toOffsetPage(rows.map(toResponse), total, query.page, query.pageSize);
  }

  async adminUnsubscribe(id: string): Promise<NewsletterSubscriberResponse> {
    return this.tx.run(async (manager) => {
      const row = await manager.findOne(NewsletterSubscriber, { where: { id }, lock: { mode: "pessimistic_write" } });
      if (!row) throw AppException.notFound("Subscriber");
      const previous = row.status;
      row.status = "unsubscribed";
      row.confirmTokenHash = null;
      await manager.save(row);
      await this.audit.record({ action: "newsletter.unsubscribe", entityType: "newsletter_subscriber", entityId: id, diff: { from: previous } }, manager);
      return toResponse(row);
    });
  }

  /** Keyset-paginated batches of subscribed rows (max `limit`), for streaming export. */
  async exportBatch(afterId: string | null, size: number): Promise<{ id: string; email: string; source: string; consentAt?: Date | null; createdAt: Date }[]> {
    const qb = this.subscribers
      .createQueryBuilder("s")
      .select(["s.id", "s.email", "s.source", "s.consentAt", "s.createdAt"])
      .where("s.status = 'subscribed'")
      .orderBy("s.id", "ASC")
      .take(size);
    if (afterId) qb.andWhere(new Brackets((w) => w.where("s.id > :afterId", { afterId })));
    return qb.getMany();
  }

  async auditExport(): Promise<void> {
    await this.audit.record({ action: "newsletter.export", entityType: "newsletter_subscriber" });
  }

  private link(path: "confirmar" | "baja", token: string): string {
    return `${this.env.STOREFRONT_URL.replace(/\/+$/, "")}/newsletter/${path}?token=${encodeURIComponent(token)}`;
  }
}

function toResponse(row: NewsletterSubscriber): NewsletterSubscriberResponse {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    source: row.source,
    consentAt: row.consentAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
