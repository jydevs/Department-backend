import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/auth/decorators";
import { AppException } from "../../common/errors/app-exception";
import { CustomerSessionService } from "../../customers/auth/customer-auth.guard";
import {
  CancelOrderBodyDto,
  CheckoutDto,
  OptionalOrderTokenQueryDto,
  CheckoutResponseDto,
  OrderNumberParamDto,
  OrderTokenQueryDto,
  PublicOrderDto,
  cartTokenSchema,
  idempotencyKeySchema,
} from "./checkout.dto";
import { CheckoutService } from "./checkout.service";

@Controller("storefront")
@Public()
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly sessions: CustomerSessionService,
  ) {}

  @Post("checkouts")
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header("Cache-Control", "no-store")
  async create(
    @Body() body: CheckoutDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-cart-token") cartToken: string | undefined,
    @Headers("authorization") authorization: string | undefined,
  ): Promise<CheckoutResponseDto> {
    const key = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!key.success) throw AppException.badRequest("IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required (8 to 120 visible characters)");
    const token = cartTokenSchema.safeParse(cartToken);
    if (!token.success) throw AppException.badRequest("CART_TOKEN_REQUIRED", "The X-Cart-Token header is required");
    // Optional customer session: a missing, invalid or expired token never blocks the purchase, the order is simply a guest order
    // (it is linked to the account later, by verified e-mail, at login / e-mail verification / password reset).
    const customerId = await this.sessions.resolve(authorization);
    return this.checkout.create(body, key.data, token.data, customerId);
  }

  @Get("orders/:orderNumber")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header("Cache-Control", "private, no-store")
  async getOrder(@Param() { orderNumber }: OrderNumberParamDto, @Query() { token }: OrderTokenQueryDto): Promise<PublicOrderDto> {
    return this.checkout.getPublicOrder(orderNumber, token);
  }

  /** Buyer cancels a pending, unpaid order. Token in `?token=` or in the body `{ token }`. */
  @Post("orders/:orderNumber/cancel")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header("Cache-Control", "private, no-store")
  async cancelOrder(
    @Param() { orderNumber }: OrderNumberParamDto,
    @Query() query: OptionalOrderTokenQueryDto,
    @Body() body: CancelOrderBodyDto | undefined,
    @Headers("authorization") authorization: string | undefined,
  ): Promise<PublicOrderDto> {
    const token = query.token ?? body?.token;
    if (!token) throw AppException.badRequest("TOKEN_REQUIRED", "The order token is required (query ?token= or body { token })");
    const customerId = await this.sessions.resolve(authorization);
    return this.checkout.cancelPublicOrder(orderNumber, token, customerId);
  }
}
