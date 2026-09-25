import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditService } from "../audit/audit.service";
import type { Actor } from "../common/auth/actor";
import { AppException } from "../common/errors/app-exception";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { TransactionService } from "../database/transaction.service";
import { SAMPLE_DATA, TEMPLATE_KEYS, TEMPLATE_VARIABLES, isTemplateKey, type TemplateKey } from "./default-templates";
import type {
  EmailTemplatePreviewResponse,
  EmailTemplateResponse,
  PreviewEmailTemplateDto,
  UpdateEmailTemplateDto,
} from "./email-templates.dto";
import { EmailTemplate } from "./entities";
import { SENSITIVE_TEMPLATES } from "./mail.worker";
import { MailService } from "./mail.service";
import { scanPlaceholders } from "./template-engine";

const TEST_SEND_LIMIT = 5;
const TEST_SEND_WINDOW_MS = 60_000;

/** `{{ someUrl }}` used as a whole attribute value. */
const URL_VARIABLE = /^\{\{\s*[A-Za-z][A-Za-z0-9_]*Url\s*\}\}$/;

@Injectable()
export class EmailTemplatesService {
  constructor(
    @InjectRepository(EmailTemplate) private readonly templates: Repository<EmailTemplate>,
    private readonly mail: MailService,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(): Promise<EmailTemplateResponse[]> {
    const rows = await this.templates.find({ order: { key: "ASC" } });
    return rows.filter((r) => isTemplateKey(r.key)).map((r) => this.toResponse(r));
  }

  async get(key: string): Promise<EmailTemplateResponse> {
    return this.toResponse(await this.load(key));
  }

  async update(actor: Actor, key: string, input: UpdateEmailTemplateDto): Promise<EmailTemplateResponse> {
    const allowed = this.allowed(key);
    // templates that carry one-time links can only be edited by owners and admins
    if (SENSITIVE_TEMPLATES.includes(key) && !(actor.kind === "staff" && actor.roles.some((r) => r === "owner" || r === "admin"))) {
      throw AppException.forbidden("Only owners and admins can edit this template");
    }
    const problems: string[] = [...this.unsafeMarkup(input.bodyHtml)];
    for (const [field, source] of [["subject", input.subject], ["bodyHtml", input.bodyHtml], ["bodyText", input.bodyText]] as const) {
      const scan = scanPlaceholders(source);
      for (const bad of scan.invalid) problems.push(`${field}: marcador inválido "${bad}"`);
      for (const path of scan.paths) if (!allowed.includes(path)) problems.push(`${field}: variable no permitida "${path}"`);
    }
    if (problems.length > 0) {
      throw AppException.badRequest("INVALID_TEMPLATE", "The template uses invalid or disallowed variables", { problems, allowed });
    }

    const saved = await this.tx.run(async (manager) => {
      const row = await manager.findOne(EmailTemplate, { where: { key }, lock: { mode: "pessimistic_write" } });
      if (!row) throw AppException.notFound("Email template");
      const changed = (["subject", "bodyHtml", "bodyText", "isActive"] as const).filter((f) => row[f] !== input[f]);
      row.subject = input.subject;
      row.bodyHtml = input.bodyHtml;
      row.bodyText = input.bodyText;
      row.isActive = input.isActive;
      const result = await manager.save(row);
      await this.audit.record({ action: "email_template.update", entityType: "email_template", entityId: row.id, diff: { key, changed } }, manager);
      return result;
    });
    return this.toResponse(saved);
  }

  async preview(key: string, input: PreviewEmailTemplateDto): Promise<EmailTemplatePreviewResponse> {
    const template = await this.load(key);
    return this.mail.render(template, this.previewData(key, input.data));
  }

  /** At most 5 test sends per minute per staff user (counted from the audit log, so it holds across instances). */
  async testSend(actor: Actor, key: string, to: string): Promise<void> {
    const template = await this.load(key);
    if (actor.kind === "staff") {
      const rows: { n: number }[] = await this.templates.manager.query(
        "SELECT count(*)::int AS n FROM audit_logs WHERE actor_id = $1 AND action = $2 AND created_at > $3",
        [actor.staffId, "email_template.test_send", new Date(Date.now() - TEST_SEND_WINDOW_MS)],
      );
      if ((rows[0]?.n ?? 0) >= TEST_SEND_LIMIT) throw new AppException(429, "RATE_LIMITED", "Too many test e-mails; try again in a minute");
    }
    await this.mail.enqueueTest(template, to, this.previewData(key, undefined));
    await this.audit.record({ action: "email_template.test_send", entityType: "email_template", entityId: template.id, diff: { key, to: to.trim().toLowerCase() } });
  }

  /** Rejects active content and links that could send readers somewhere else than the store. */
  private unsafeMarkup(html: string): string[] {
    const problems: string[] = [];
    const banned: [RegExp, string][] = [
      [/<\s*script/i, "<script>"],
      [/<\s*iframe/i, "<iframe>"],
      [/<\s*form/i, "<form>"],
      [/javascript\s*:/i, "javascript:"],
      [/\b(?:href|src)\s*=\s*["']?\s*data\s*:/i, "data: URLs"],
      [/\bon\w+\s*=/i, "event handler attributes (on...=)"],
    ];
    for (const [pattern, label] of banned) if (pattern.test(html)) problems.push(`bodyHtml: no se permite ${label}`);

    let storefrontHost = "";
    try {
      storefrontHost = new URL(this.env.STOREFRONT_URL).host;
    } catch {
      /* validated at boot */
    }
    for (const match of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (URL_VARIABLE.test(value) || /^mailto:/i.test(value)) continue;
      let allowed: boolean;
      try {
        const url = new URL(value);
        allowed = url.protocol === "https:" && url.host === storefrontHost;
      } catch {
        allowed = false;
      }
      if (!allowed) problems.push(`bodyHtml: enlace no permitido "${value.slice(0, 60)}"`);
    }
    return problems;
  }

  private previewData(key: string, data: Record<string, unknown> | undefined): Record<string, unknown> {
    const sample = isTemplateKey(key) ? SAMPLE_DATA[key] : {};
    return { ...sample, ...(data ?? {}) };
  }

  private allowed(key: string): readonly string[] {
    if (!isTemplateKey(key)) throw AppException.notFound("Email template");
    return TEMPLATE_VARIABLES[key];
  }

  private async load(key: string): Promise<EmailTemplate> {
    this.allowed(key);
    const row = await this.templates.findOne({ where: { key } });
    if (!row) throw AppException.notFound("Email template");
    return row;
  }

  private toResponse(row: EmailTemplate): EmailTemplateResponse {
    const key = row.key as TemplateKey;
    return {
      key: row.key,
      subject: row.subject,
      bodyHtml: row.bodyHtml,
      bodyText: row.bodyText,
      isActive: row.isActive,
      variables: [...(TEMPLATE_KEYS.includes(key) ? TEMPLATE_VARIABLES[key] : [])],
      updatedAt: row.updatedAt,
    };
  }
}
