import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { OffsetPage, PageQueryDto } from "../common/pagination/pagination";
import { CurrentCustomerId, CustomerAuth } from "./auth/customer-auth.guard";
import { CustomersAccountService } from "./customers-account.service";
import {
  AddressIdParamDto,
  CreateAddressDto,
  CustomerChangePasswordDto,
  DeleteAccountDto,
  OrderNumberParamDto,
  UpdateAddressDto,
  UpdateProfileDto,
  type CustomerAddressDto,
  type CustomerDataExportDto,
  type CustomerProfileDto,
  type MessageResponse,
  type PublicOrderDetailDto,
  type PublicOrderSummaryDto,
} from "./dto/customers.dto";

/** The logged-in customer's own account. Nothing here accepts a customer id: it always comes from the token. */
@ApiTags("storefront-customers-account")
@ApiBearerAuth()
@CustomerAuth()
@Controller("storefront/customers/me")
export class CustomersAccountController {
  constructor(private readonly account: CustomersAccountService) {}

  @Get()
  @ApiOperation({ summary: "My profile" })
  async profile(@CurrentCustomerId() id: string, @Res({ passthrough: true }) res: Response): Promise<CustomerProfileDto> {
    res.setHeader("Cache-Control", "no-store");
    return this.account.getProfile(id);
  }

  @Patch()
  @ApiOperation({ summary: "Update my profile" })
  async update(@CurrentCustomerId() id: string, @Body() dto: UpdateProfileDto): Promise<CustomerProfileDto> {
    return this.account.updateProfile(id, dto);
  }

  @Post("change-password")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Change my password (signs out every session)" })
  async changePassword(@CurrentCustomerId() id: string, @Body() dto: CustomerChangePasswordDto): Promise<MessageResponse> {
    await this.account.changePassword(id, dto.currentPassword, dto.newPassword);
    return { message: "Password changed. Please log in again." };
  }

  @Get("addresses")
  @ApiOperation({ summary: "My saved addresses" })
  async listAddresses(@CurrentCustomerId() id: string): Promise<CustomerAddressDto[]> {
    return this.account.listAddresses(id);
  }

  @Post("addresses")
  @ApiOperation({ summary: "Save an address (max 10)" })
  async createAddress(@CurrentCustomerId() id: string, @Body() dto: CreateAddressDto): Promise<CustomerAddressDto> {
    return this.account.createAddress(id, dto);
  }

  @Patch("addresses/:addressId")
  @ApiOperation({ summary: "Update a saved address" })
  async updateAddress(
    @CurrentCustomerId() id: string,
    @Param() { addressId }: AddressIdParamDto,
    @Body() dto: UpdateAddressDto,
  ): Promise<CustomerAddressDto> {
    return this.account.updateAddress(id, addressId, dto);
  }

  @Delete("addresses/:addressId")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a saved address" })
  async deleteAddress(@CurrentCustomerId() id: string, @Param() { addressId }: AddressIdParamDto): Promise<void> {
    await this.account.deleteAddress(id, addressId);
  }

  @Get("orders")
  @ApiOperation({ summary: "My orders" })
  async listOrders(@CurrentCustomerId() id: string, @Query() { page, pageSize }: PageQueryDto): Promise<OffsetPage<PublicOrderSummaryDto>> {
    return this.account.listOrders(id, page, pageSize);
  }

  @Get("orders/:orderNumber")
  @ApiOperation({ summary: "One of my orders" })
  async getOrder(@CurrentCustomerId() id: string, @Param() { orderNumber }: OrderNumberParamDto): Promise<PublicOrderDetailDto> {
    return this.account.getOrder(id, orderNumber);
  }

  @Post("data-export")
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: "Download all my personal data (Habeas Data)" })
  async dataExport(@CurrentCustomerId() id: string, @Res({ passthrough: true }) res: Response): Promise<CustomerDataExportDto> {
    res.setHeader("Cache-Control", "no-store");
    return this.account.exportData(id);
  }

  @Delete()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Delete (anonymize) my account; requires my password" })
  async deleteAccount(@CurrentCustomerId() id: string, @Body() dto: DeleteAccountDto, @Res({ passthrough: true }) res: Response): Promise<MessageResponse> {
    await this.account.deleteAccount(id, dto.password);
    res.clearCookie("dept_ct", { path: "/api/v1/storefront/customers" });
    return { message: "Your account has been deleted" };
  }
}
