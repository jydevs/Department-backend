import { Injectable, Logger } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { z } from "zod";
import { Clock } from "../common/clock/clock";
import { AppException } from "../common/errors/app-exception";
import { EmailOutbox, EmailTemplate } from "./entities";
import { renderSubject, renderTemplate } from "./template-engine";

export interface EnqueueMailInput {
  to: string;
  template: string;
  data: Record<string, unknown>;
}

export interface RenderedMail {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

const emailSchema = z.email().max(255);

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  /** Pure render of a stored template. HTML is always entity-escaped. */
  render(template: Pick<EmailTemplate, "subject" | "bodyHtml" | "bodyText">, data: Record<string, unknown>): RenderedMail {
    return {
      subject: renderSubject(template.subject, data),
      bodyHtml: renderTemplate(template.bodyHtml, data, { html: true }),
      bodyText: renderTemplate(template.bodyText, data, { html: false }),
    };
  }

  /**
   * Render the active template and write it to email_outbox. Sends nothing: the MailWorker delivers.
   * Pass the caller's transaction manager so the mail commits (or rolls back) with the business change.
   */
  async enqueue(input: EnqueueMailInput, manager?: EntityManager): Promise<void> {
    const em = manager ?? this.dataSource.manager;
    const to = this.validateRecipient(input.to);
    const template = await em.findOne(EmailTemplate, { where: { key: input.template } });
    if (!template) {
      this.logger.error(`Email template "${input.template}" does not exist; nothing enqueued`);
      return;
    }
    if (!template.isActive) return; // the admin switched this mail off
    await this.insertOutbox(em, to, template.key, this.render(template, input.data));
  }

  /** Admin test send: renders with the given data even when the template is inactive. */
  async enqueueTest(template: EmailTemplate, to: string, data: Record<string, unknown>): Promise<void> {
    const rendered = this.render(template, data);
    await this.insertOutbox(this.dataSource.manager, this.validateRecipient(to), template.key, {
      ...rendered,
      subject: `[PRUEBA] ${rendered.subject}`.slice(0, 255),
    });
  }

  private validateRecipient(to: string): string {
    const parsed = emailSchema.safeParse(to.trim());
    if (!parsed.success) throw AppException.badRequest("INVALID_EMAIL", "Invalid recipient e-mail address");
    return parsed.data.toLowerCase();
  }

  private async insertOutbox(em: EntityManager, to: string, template: string, rendered: RenderedMail): Promise<void> {
    await em.save(
      em.create(EmailOutbox, {
        to,
        template,
        subject: rendered.subject,
        bodyHtml: rendered.bodyHtml,
        bodyText: rendered.bodyText,
        status: "pending",
        attempts: 0,
        lastError: null,
        sendAfter: this.clock.now(),
        sentAt: null,
      }),
    );
  }
}
