import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { Actor } from "../../common/auth/actor";
import { IdParamDto } from "../../common/params/params";
import { OffsetPage, PageQueryDto } from "../../common/pagination/pagination";
import { OrdersAdminService } from "./orders-admin.service";
import { FulfillmentsService } from "./fulfillments.service";
import { RefundsService } from "./refunds.service";
import {
  FulfillmentCreateDto,
  FulfillmentResultDto,
  OrderCancelDto,
  OrderDetailDto,
  OrderEventDto,
  OrderFulfillmentParamDto,
  OrderListQueryDto,
  OrderMarkPaidDto,
  OrderNoteDto,
  OrderSummaryDto,
  OrderUpdateDto,
  RefundCreateDto,
  RefundResultDto,
} from "./dto/orders-admin.dto";
import { toEventActor } from "./order-support";

@Controller("admin/orders")
export class OrdersAdminController {
  constructor(
    private readonly orders: OrdersAdminService,
    private readonly fulfillments: FulfillmentsService,
    private readonly refunds: RefundsService,
  ) {}

  @Get()
  @RequirePermissions("orders:read")
  list(@Query() query: OrderListQueryDto): Promise<OffsetPage<OrderSummaryDto>> {
    return this.orders.list(query);
  }

  @Get(":id")
  @RequirePermissions("orders:read")
  detail(@Param() { id }: IdParamDto): Promise<OrderDetailDto> {
    return this.orders.getDetail(id);
  }

  @Get(":id/timeline")
  @RequirePermissions("orders:read")
  timeline(@Param() { id }: IdParamDto, @Query() { page, pageSize }: PageQueryDto): Promise<OffsetPage<OrderEventDto>> {
    return this.orders.timeline(id, page, pageSize);
  }

  @Patch(":id")
  @RequirePermissions("orders:write")
  update(@Param() { id }: IdParamDto, @Body() body: OrderUpdateDto, @CurrentActor() actor: Actor): Promise<OrderDetailDto> {
    return this.orders.update(id, body, toEventActor(actor));
  }

  @Post(":id/notes")
  @RequirePermissions("orders:write")
  addNote(@Param() { id }: IdParamDto, @Body() body: OrderNoteDto, @CurrentActor() actor: Actor): Promise<OrderEventDto> {
    return this.orders.addNote(id, body.note, toEventActor(actor));
  }

  @Post(":id/cancel")
  @RequirePermissions("orders:write")
  cancel(@Param() { id }: IdParamDto, @Body() body: OrderCancelDto, @CurrentActor() actor: Actor): Promise<OrderDetailDto> {
    return this.orders.cancel(id, body, actor);
  }

  @Post(":id/mark-paid")
  @RequirePermissions("orders:payments")
  markPaid(@Param() { id }: IdParamDto, @Body() body: OrderMarkPaidDto, @CurrentActor() actor: Actor): Promise<OrderDetailDto> {
    return this.orders.markPaid(id, body, actor);
  }

  @Post(":id/fulfillments")
  @RequirePermissions("orders:write")
  createFulfillment(@Param() { id }: IdParamDto, @Body() body: FulfillmentCreateDto, @CurrentActor() actor: Actor): Promise<FulfillmentResultDto> {
    return this.fulfillments.create(id, body, toEventActor(actor));
  }

  @Post(":id/fulfillments/:fid/cancel")
  @RequirePermissions("orders:write")
  cancelFulfillment(@Param() { id, fid }: OrderFulfillmentParamDto, @CurrentActor() actor: Actor): Promise<FulfillmentResultDto> {
    return this.fulfillments.cancel(id, fid, toEventActor(actor));
  }

  @Post(":id/refunds")
  @RequirePermissions("orders:refunds")
  createRefund(@Param() { id }: IdParamDto, @Body() body: RefundCreateDto, @CurrentActor() actor: Actor): Promise<RefundResultDto> {
    return this.refunds.create(id, body, toEventActor(actor));
  }
}
