import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/auth/decorators";
import { AppException } from "../../common/errors/app-exception";
import {
  CheckoutDto,
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
  constructor(private readonly checkout: CheckoutService) {}

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
    // optional: a signed-in customer's Bearer links the order to the account (only if the e-mail is the verified one); a bad token is ignored
    return this.checkout.create(body, key.data, token.data, authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined);
  }

  @Get("orders/:orderNumber")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header("Cache-Control", "private, no-store")
  async getOrder(@Param() { orderNumber }: OrderNumberParamDto, @Query() { token }: OrderTokenQueryDto): Promise<PublicOrderDto> {
    return this.checkout.getPublicOrder(orderNumber, token);
  }
}
