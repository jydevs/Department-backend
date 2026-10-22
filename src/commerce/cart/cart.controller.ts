import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/auth/decorators";
import { CartToken } from "./cart-token.decorator";
import { CartService } from "./cart.service";
import {
  AddCartLineDto,
  CartLineParamDto,
  CartParamDto,
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
  constructor(private readonly carts: CartService) {}

  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  create(): Promise<CartCreatedResponse> {
    return this.carts.create();
  }

  @Get(":id")
  get(@Param() { id }: CartParamDto, @CartToken() token: string, @Query() query: GetCartQueryDto): Promise<CartResponse> {
    return this.carts.get(id, token, query);
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
  setDiscount(@Param() { id }: CartParamDto, @CartToken() token: string, @Body() body: SetCartDiscountDto): Promise<CartResponse> {
    return this.carts.setDiscount(id, token, body.code, body.email);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param() { id }: CartParamDto, @CartToken() token: string): Promise<void> {
    await this.carts.remove(id, token);
  }
}
