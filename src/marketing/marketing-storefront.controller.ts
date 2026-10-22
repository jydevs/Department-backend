import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../common/auth/decorators";
import { ContactService } from "./contact.service";
import {
  CreateContactMessageDto,
  NewsletterTokenQueryDto,
  SubscribeNewsletterDto,
  type AcceptedResponse,
  type NewsletterTokenResponse,
} from "./marketing.dto";
import { NewsletterService } from "./newsletter.service";

@Controller("storefront")
@Public()
export class MarketingStorefrontController {
  constructor(
    private readonly newsletter: NewsletterService,
    private readonly contact: ContactService,
  ) {}

  @Post("newsletter")
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  subscribe(@Body() body: SubscribeNewsletterDto): AcceptedResponse {
    this.newsletter.subscribe(body.email, body.source);
    return { accepted: true };
  }

  /** @deprecated State change on GET: kept only because the current storefront BFF still calls it. Use POST /newsletter/confirm. */
  @Get("newsletter/confirm")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirm(@Query() { token }: NewsletterTokenQueryDto): Promise<NewsletterTokenResponse> {
    return this.newsletter.confirm(token);
  }

  @Post("newsletter/confirm")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirmPost(@Query() { token }: NewsletterTokenQueryDto): Promise<NewsletterTokenResponse> {
    return this.newsletter.confirm(token);
  }

  /** Only validates the token (200 `{ status: "valid" }` or 400 INVALID_TOKEN); unsubscribing is the POST. */
  @Get("newsletter/unsubscribe")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  unsubscribeGet(@Query() { token }: NewsletterTokenQueryDto): Promise<NewsletterTokenResponse> {
    return this.newsletter.checkUnsubscribeToken(token);
  }

  @Post("newsletter/unsubscribe")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  unsubscribePost(@Query() { token }: NewsletterTokenQueryDto): Promise<NewsletterTokenResponse> {
    return this.newsletter.unsubscribeByToken(token);
  }

  @Post("contact")
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async sendContact(@Body() body: CreateContactMessageDto): Promise<AcceptedResponse> {
    await this.contact.create(body);
    return { accepted: true };
  }
}
