import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

/** DI token for the active transport (chosen by MAIL_TRANSPORT). */
export const MAIL_TRANSPORT = Symbol("MAIL_TRANSPORT");

/** Dev/test: nothing leaves the process. The message stays in email_outbox and is marked sent. */
@Injectable()
export class LogTransport implements MailTransport {
  private readonly logger = new Logger("MailLog");

  constructor(@Inject(ENV) private readonly env: Env) {}

  send(mail: OutgoingMail): Promise<void> {
    this.logger.log(`[mail:log] to=${mail.to} subject="${mail.subject}"`);
    // never the body in production; elsewhere links lose their token so the log cannot be used to take over an account
    if (this.env.NODE_ENV !== "production") this.logger.debug(mail.text.replace(/token=[^\s&"<>]*/g, "token=[redacted]"));
    return Promise.resolve();
  }
}

@Injectable()
export class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(@Inject(ENV) env: Env) {
    if (!env.SMTP_URL) throw new Error("MAIL_TRANSPORT=smtp requires SMTP_URL");
    this.from = env.MAIL_FROM;
    this.transporter = createTransport({
      url: env.SMTP_URL,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
  }
}
