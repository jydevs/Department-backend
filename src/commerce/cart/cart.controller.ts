import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiHeader } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AppException } from "../../common/errors/app-exception";
import { Public } from "../../common/auth/decorators";
import { RateWindow } from "../../common/throttle/rate-window";
import { visitorIp } from "../../common/throttle/storefront-throttler.guard";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { CartToken } from "./cart-token.decorator";
import { CartService } from "./cart.service";
import {
  AddCartLineDto,
  CartLineParamDto,
  CartParamDto,
  quoteEmailHeaderSchema,
  GetCartQueryDto,
  SetCartDiscountDto,
  UpdateCartLineDto,
  type CartCreatedResponse,
  type CartResponse,
} from "./cart.dto";

@Controller("storefront/carts")
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class CartController {
  /** Discount-code guessing brakes: ~10 tries/min per visitor+cart and a higher cap per visitor across carts. */
  private readonly discountPerCart = new RateWindow(10, 60_000);
  private readonly discountPerIp = new RateWindow(40, 60_000);

  constructor(
    private readonly carts: CartService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  create(): Promise<CartCreatedResponse> {
    return this.carts.create();
  }

  @Get(":id")
  @ApiHeader({ name: "X-Quote-Email", required: false, description: "Buyer e-mail for once-per-email discount validation (alternative to ?email=; never logged)" })
  get(
    @Param() { id }: CartParamDto,
    @CartToken() token: string,
    @Query() query: GetCartQueryDto,
    @Headers("x-quote-email") quoteEmail?: string,
  ): Promise<CartResponse> {
    // `X-Quote-Email` is an alternative to `?email=` (the query wins if both come); the value is never logged
    let email = query.email;
    if (email === undefined && quoteEmail !== undefined && quoteEmail !== "") {
      const parsed = quoteEmailHeaderSchema.safeParse(quoteEmail);
      if (!parsed.success) throw AppException.badRequest("VALIDATION_ERROR", "The X-Quote-Email header is not a valid e-mail");
      email = parsed.data;
    }
    return this.carts.get(id, token, email === undefined ? query : { ...query, email });
  }

  @Post(":id/lines")
  addLine(@Param() { id }: CartParamDto, @CartToken() token: string, @Body() body: AddCartLineDto): Promise<CartResponse> {
    return this.carts.addLine(id, token, body.variantId, body.quantity);
  }

  @Patch(":id/lines/:variantId")
  updateLine(
    @Param() { id, variantId }: CartLineParamDto,
    @CartToken() token: string,
    @Body() body: UpdateCartLineDto,
  ): Promise<CartResponse> {
    return this.carts.setLineQuantity(id, token, variantId, body.quantity);
  }

  @Delete(":id/lines/:variantId")
  removeLine(@Param() { id, variantId }: CartLineParamDto, @CartToken() token: string): Promise<CartResponse> {
    return this.carts.removeLine(id, token, variantId);
  }

  @Put(":id/discount")
  setDiscount(
    @Param() { id }: CartParamDto,
    @CartToken() token: string,
    @Body() body: SetCartDiscountDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartResponse> {
    const ip = visitorIp(req, this.env.STOREFRONT_SERVER_KEY);
    // per-visitor cap first (one key per visitor); the per-cart key is only created once the visitor is within its cap,
    // so spraying random cart ids cannot fill the map with keys
    const cartKey = `${ip}|${id}`;
    const limitedBy = !this.discountPerIp.hit(ip) ? ([this.discountPerIp, ip] as const) : !this.discountPerCart.hit(cartKey) ? ([this.discountPerCart, cartKey] as const) : null;
    if (limitedBy) {
      res.setHeader("Retry-After", String(limitedBy[0].retryAfterSeconds(limitedBy[1])));
      throw new AppException(429, "RATE_LIMITED", "Too many discount attempts, try again in a minute");
    }
    return this.carts.setDiscount(id, token, body.code, body.email);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param() { id }: CartParamDto, @CartToken() token: string): Promise<void> {
    await this.carts.remove(id, token);
  }
}
