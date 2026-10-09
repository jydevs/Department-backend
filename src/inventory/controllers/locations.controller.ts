import { Controller, Get, Post, Patch, Delete, Param, Body } from "@nestjs/common";
import { InventoryService } from "../inventory.service";
import { RequirePermissions } from "../../common/auth/decorators";
import { IdParamDto } from "../../common/params/params";
import { AppException } from "../../common/errors/app-exception";
import { CreateLocationDto, UpdateLocationDto, LocationDto } from "../dto/location.dto";

@Controller("admin/locations")
export class LocationsController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @RequirePermissions("inventory:read")
  async listLocations(): Promise<LocationDto[]> {
    return this.inventoryService.listLocations();
  }

  @Post()
  @RequirePermissions("inventory:write")
  async createLocation(@Body() input: CreateLocationDto): Promise<LocationDto> {
    return this.inventoryService.createLocation(input);
  }

  @Get(":id")
  @RequirePermissions("inventory:read")
  async getLocation(@Param() { id }: IdParamDto): Promise<LocationDto> {
    const location = await this.inventoryService.getLocationById(id);
    if (!location) {
      throw AppException.notFound("Location");
    }
    return location;
  }

  @Patch(":id")
  @RequirePermissions("inventory:write")
  async updateLocation(@Param() { id }: IdParamDto, @Body() input: UpdateLocationDto): Promise<LocationDto> {
    return this.inventoryService.updateLocation(id, input);
  }

  @Delete(":id")
  @RequirePermissions("inventory:write")
  async deleteLocation(@Param() { id }: IdParamDto): Promise<void> {
    await this.inventoryService.deleteLocation(id);
  }
}
