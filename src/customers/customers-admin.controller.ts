import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Actor } from "../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../common/auth/decorators";
import { AppException } from "../common/errors/app-exception";
import { OffsetPage } from "../common/pagination/pagination";
import { IdParamDto } from "../common/params/params";
import { CustomersAdminService } from "./customers-admin.service";
import {
  AdminUpdateCustomerDto,
  CustomerExportQueryDto,
  CustomerListQueryDto,
  type AdminCustomerDetailDto,
  type AdminCustomerDto,
  type MessageResponse,
} from "./dto/customers.dto";

@ApiTags("admin-customers")
@ApiBearerAuth()
@Controller("admin/customers")
export class CustomersAdminController {
  constructor(private readonly service: CustomersAdminService) {}

  @Get()
  @RequirePermissions("customers:read")
  @ApiOperation({ summary: "List customers (search, filters, pagination)" })
  async list(@Query() query: CustomerListQueryDto): Promise<OffsetPage<AdminCustomerDto>> {
    return this.service.list(query);
  }

  /** Declared before `:id` so "export" is never parsed as an id. Bulk personal data: needs write access. */
  @Get("export")
  @RequirePermissions("customers:write")
  @ApiOperation({ summary: "Export customers as CSV (streamed, max 50 000 rows)" })
  async export(@Query() query: CustomerExportQueryDto, @Res() res: Response): Promise<void> {
    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="customers.csv"');
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    try {
      for await (const chunk of this.service.exportCsv(query)) {
        if (res.destroyed) return;
        if (!res.write(chunk)) await new Promise<void>((resolve) => res.once("drain", resolve).once("close", resolve));
      }
      res.end();
    } catch (err) {
      // headers are already sent: the only honest signal left is to cut the connection
      res.destroy(err instanceof Error ? err : undefined);
    }
  }

  @Get(":id")
  @RequirePermissions("customers:read")
  @ApiOperation({ summary: "Customer detail with orders and addresses" })
  async detail(@Param() { id }: IdParamDto): Promise<AdminCustomerDetailDto> {
    return this.service.detail(id);
  }

  @Patch(":id")
  @RequirePermissions("customers:write")
  @ApiOperation({ summary: "Update name, phone, tags, note or active flag" })
  async update(@Param() { id }: IdParamDto, @Body() dto: AdminUpdateCustomerDto): Promise<AdminCustomerDto> {
    return this.service.update(id, dto);
  }

  @Post(":id/erase")
  @HttpCode(200)
  @RequirePermissions("customers:write")
  @ApiOperation({ summary: "Anonymize a customer (irreversible; owner/admin only)" })
  async erase(@Param() { id }: IdParamDto, @CurrentActor() actor: Actor): Promise<MessageResponse> {
    if (actor.kind !== "staff") throw AppException.unauthorized();
    if (!actor.roles.some((role) => role === "owner" || role === "admin")) {
      throw AppException.forbidden("Only owners and admins can erase customers");
    }
    await this.service.erase(id);
    return { message: "Customer anonymized" };
  }
}
