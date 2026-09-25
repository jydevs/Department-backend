import { Inject, Logger, Module, OnModuleInit } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DatabaseModule } from "../database/database.module";
import { EmailTemplatesController } from "./email-templates.controller";
import { EmailTemplatesService } from "./email-templates.service";
import { EmailOutbox, EmailTemplate } from "./entities";
import { MailService } from "./mail.service";
import { LogTransport, MAIL_TRANSPORT, SmtpTransport, type MailTransport } from "./mail.transport";
import { MailWorker } from "./mail.worker";
import { seedEmailTemplates } from "./seed-templates";

@Module({
  imports: [TypeOrmModule.forFeature([EmailOutbox, EmailTemplate]), DatabaseModule],
  providers: [
    MailService,
    MailWorker,
    EmailTemplatesService,
    {
      provide: MAIL_TRANSPORT,
      inject: [ENV],
      useFactory: (env: Env): MailTransport => (env.MAIL_TRANSPORT === "smtp" ? new SmtpTransport(env) : new LogTransport()),
    },
  ],
  controllers: [EmailTemplatesController],
  exports: [MailService],
})
export class MailModule implements OnModuleInit {
  private readonly logger = new Logger(MailModule.name);

  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      const inserted = await seedEmailTemplates(this.dataSource);
      if (inserted > 0) this.logger.log(`Seeded ${inserted} default e-mail template(s)`);
    } catch (err) {
      this.logger.error(`Could not seed e-mail templates: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
