import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Throttle } from "@nestjs/throttler";
import { Repository } from "typeorm";
import { Public } from "../../common/auth/decorators";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { Order } from "../entities";
import { MockProvider } from "./mock.provider";
import { PaymentEventsService } from "./payment-events.service";
import { MockPaymentDto, MockPaymentResultDto } from "./payments.dto";

/** Development only (`NODE_ENV !== production` AND `PAYMENT_PROVIDER=mock`): simulates the gateway calling the webhook. */
@Controller("storefront/dev")
@Public()
export class MockPaymentController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly mock: MockProvider,
    private readonly events: PaymentEventsService,
  ) {}

  @Post("mock-payment")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async simulate(@Body() body: MockPaymentDto): Promise<MockPaymentResultDto> {
    if (this.env.NODE_ENV === "production" || this.env.MOCK_PAYMENTS_ENABLED !== true || this.env.PAYMENT_PROVIDER !== "mock") throw AppException.notFound("Resource");

    const order = await this.orders.findOne({ where: { paymentReference: body.reference } });
    if (!order) throw AppException.notFound("Order");

    // Same code path as a real webhook: signed body -> signature verification -> shared processing.
    const { rawBody, headers } = this.mock.buildSignedEvent(order, body.status);
    const outcome = await this.events.handleWebhook(headers, rawBody);
    return { reference: body.reference, status: body.status, outcome };
  }
}
