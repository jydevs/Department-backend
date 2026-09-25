import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditService } from "../audit/audit.service";
import { AppException } from "../common/errors/app-exception";
import { TransactionService } from "../database/transaction.service";
import { SAMPLE_DATA, TEMPLATE_KEYS, TEMPLATE_VARIABLES, isTemplateKey, type TemplateKey } from "./default-templates";
import type {
  EmailTemplatePreviewResponse,
  EmailTemplateResponse,
  PreviewEmailTemplateDto,
  UpdateEmailTemplateDto,
} from "./email-templates.dto";
import { EmailTemplate } from "./entities";
import { MailService } from "./mail.service";
import { scanPlaceholders } from "./template-engine";

@Injectable()
export class EmailTemplatesService {
  constructor(
    @InjectRepository(EmailTemplate) private readonly templates: Repository<EmailTemplate>,
    private readonly mail: MailService,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<EmailTemplateResponse[]> {
    const rows = await this.templates.find({ order: { key: "ASC" } });
    return rows.filter((r) => isTemplateKey(r.key)).map((r) => this.toResponse(r));
  }

  async get(key: string): Promise<EmailTemplateResponse> {
    return this.toResponse(await this.load(key));
  }

  async update(key: string, input: UpdateEmailTemplateDto): Promise<EmailTemplateResponse> {
    const allowed = this.allowed(key);
    const problems: string[] = [];
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

  async testSend(key: string, to: string): Promise<void> {
    const template = await this.load(key);
    await this.mail.enqueueTest(template, to, this.previewData(key, undefined));
    await this.audit.record({ action: "email_template.test_send", entityType: "email_template", entityId: template.id, diff: { key } });
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
