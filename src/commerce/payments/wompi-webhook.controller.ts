import { Controller, Headers, HttpCode, Post, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { Public } from "../../common/auth/decorators";
import { WebhookAckDto } from "./payments.dto";
import { PaymentEventsService } from "./payment-events.service";
import type { WebhookHeaders } from "./payment-provider";

/**
 * Lives OUTSIDE `/api/v1` (`webhooks/*path` must be excluded from the global prefix in main.ts).
 * Authenticity comes from the provider signature over the raw body, never from a session.
 */
@Controller("webhooks/wompi")
@Public()
@SkipThrottle()
export class WompiWebhookController {
  constructor(private readonly events: PaymentEventsService) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers() headers: WebhookHeaders): Promise<WebhookAckDto> {
    await this.events.handleWebhook(headers, req.rawBody);
    return { received: true };
  }
}
