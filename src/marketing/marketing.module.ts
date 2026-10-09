import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatabaseModule } from "../database/database.module";
import { MailModule } from "../mail/mail.module";
import { ContactService } from "./contact.service";
import { ContactMessage, NewsletterSubscriber } from "./entities";
import { MarketingAdminController } from "./marketing-admin.controller";
import { MarketingStorefrontController } from "./marketing-storefront.controller";
import { NewsletterService } from "./newsletter.service";

@Module({
  imports: [TypeOrmModule.forFeature([NewsletterSubscriber, ContactMessage]), DatabaseModule, MailModule],
  providers: [NewsletterService, ContactService],
  controllers: [MarketingStorefrontController, MarketingAdminController],
})
export class MarketingModule {}
