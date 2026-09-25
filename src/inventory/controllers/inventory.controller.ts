import { Controller, Get, Post, Query, Body } from "@nestjs/common";
import { InventoryService } from "../inventory.service";
import { RequirePermissions, CurrentActor } from "../../common/auth/decorators";
import { OffsetPage, CursorPage } from "../../common/pagination/pagination";
import { Actor } from "../../common/auth/actor";
import {
  InventoryQueryDto,
  AdjustInventoryDto,
  AdjustmentQueryDto,
  InventoryLevelDto,
  InventoryAdjustmentDto,
} from "../dto/inventory-level.dto";

@Controller("admin/inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @RequirePermissions("inventory:read")
  async listInventory(@Query() query: InventoryQueryDto): Promise<OffsetPage<InventoryLevelDto>> {
    return this.inventoryService.listInventoryLevels(query);
  }

  @Post("adjust")
  @RequirePermissions("inventory:write")
  async adjustInventory(@Body() input: AdjustInventoryDto, @CurrentActor() actor: Actor): Promise<InventoryAdjustmentDto> {
    const actorId = actor.kind === "staff" ? actor.staffId : undefined;
    return this.inventoryService.adjustInventory(input, actorId);
  }

  @Get("adjustments")
  @RequirePermissions("inventory:read")
  async listAdjustments(@Query() query: AdjustmentQueryDto): Promise<CursorPage<InventoryAdjustmentDto>> {
    const { limit, cursor, variantId } = query;
    return this.inventoryService.listAdjustments(limit, cursor, variantId);
  }
}
