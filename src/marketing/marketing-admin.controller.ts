import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { once } from "node:events";
import { RequirePermissions } from "../common/auth/decorators";
import { IdParamDto } from "../common/params/params";
import type { OffsetPage } from "../common/pagination/pagination";
import { csvRow } from "../common/csv";
import { ContactService } from "./contact.service";
import {
  ContactMessageListQueryDto,
  NewsletterListQueryDto,
  UpdateContactMessageDto,
  type ContactMessageResponse,
  type NewsletterSubscriberResponse,
} from "./marketing.dto";
import { NewsletterService } from "./newsletter.service";

const EXPORT_MAX_ROWS = 50_000;
const EXPORT_BATCH = 1_000;

@Controller("admin")
export class MarketingAdminController {
  constructor(
    private readonly newsletter: NewsletterService,
    private readonly contact: ContactService,
  ) {}

  @Get("contact-messages")
  @RequirePermissions("marketing:read")
  listContact(@Query() query: ContactMessageListQueryDto): Promise<OffsetPage<ContactMessageResponse>> {
    return this.contact.list(query);
  }

  @Patch("contact-messages/:id")
  @RequirePermissions("marketing:write")
  updateContact(@Param() { id }: IdParamDto, @Body() body: UpdateContactMessageDto): Promise<ContactMessageResponse> {
    return this.contact.updateStatus(id, body.status);
  }

  @Delete("contact-messages/:id")
  @HttpCode(204)
  @RequirePermissions("marketing:write")
  async removeContact(@Param() { id }: IdParamDto): Promise<void> {
    await this.contact.remove(id);
  }

  @Get("newsletter")
  @RequirePermissions("marketing:read")
  listNewsletter(@Query() query: NewsletterListQueryDto): Promise<OffsetPage<NewsletterSubscriberResponse>> {
    return this.newsletter.list(query);
  }

  /** CSV of subscribed addresses only, streamed in keyset batches (max 50 000 rows). */
  @Get("newsletter/export")
  @RequirePermissions("marketing:write")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="newsletter-subscribers.csv"')
  @Header("Cache-Control", "no-store")
  async exportNewsletter(@Res() res: Response): Promise<void> {
    await this.newsletter.auditExport();
    let written = 0;
    let after: string | null = null;
    try {
      res.write(csvRow(["email", "source", "consent_at", "created_at"]));
      while (written < EXPORT_MAX_ROWS) {
        const rows = await this.newsletter.exportBatch(after, Math.min(EXPORT_BATCH, EXPORT_MAX_ROWS - written));
        if (rows.length === 0) break;
        for (const r of rows) {
          const ok = res.write(csvRow([r.email, r.source, r.consentAt?.toISOString() ?? "", r.createdAt.toISOString()]));
          if (!ok) await once(res, "drain");
        }
        written += rows.length;
        after = rows[rows.length - 1]?.id ?? null;
        if (rows.length < EXPORT_BATCH) break;
      }
    } catch {
      res.destroy(); // headers are already sent: a truncated body is the honest signal
      return;
    }
    res.end();
  }

  @Post("newsletter/:id/unsubscribe")
  @HttpCode(200)
  @RequirePermissions("marketing:write")
  unsubscribe(@Param() { id }: IdParamDto): Promise<NewsletterSubscriberResponse> {
    return this.newsletter.adminUnsubscribe(id);
  }
}
