import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from "@nestjs/common";
import { StaffService } from "./staff.service";
import { RequirePermissions, CurrentActor } from "../../common/auth/decorators";
import { PageQueryDto, toOffsetPage } from "../../common/pagination/pagination";
import { IdParamDto } from "../../common/params/params";
import { AppException } from "../../common/errors/app-exception";
import { Actor } from "../../common/auth/actor";
import { CreateStaffDto, CreateStaffResponseDto } from "./dto/staff-create.dto";
import { StaffDto } from "./dto/staff-response.dto";
import { UpdateStaffDto } from "./dto/staff-update.dto";
import { OffsetPage } from "../../common/pagination/pagination";

@Controller("admin/staff")
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @RequirePermissions("staff:read")
  async listStaff(@Query() query: PageQueryDto): Promise<OffsetPage<StaffDto>> {
    const { page, pageSize } = query;
    const { items, total } = await this.staffService.list(page, pageSize);
    return toOffsetPage(items as StaffDto[], total, page, pageSize);
  }

  @Post()
  @RequirePermissions("staff:write")
  async createStaff(@Body() input: CreateStaffDto, @CurrentActor() actor: Actor): Promise<CreateStaffResponseDto> {
    if (actor.kind !== "staff") {
      throw AppException.unauthorized();
    }

    const isOwner = actor.roles.includes("owner");
    const { staff, password } = await this.staffService.create(input, isOwner);

    return {
      id: staff.id,
      email: staff.email,
      fullName: staff.fullName,
      isActive: staff.isActive,
      roleId: staff.roleId,
      totpEnabled: staff.totpEnabled,
      password,
      createdAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    } as CreateStaffResponseDto;
  }

  @Get(":id")
  @RequirePermissions("staff:read")
  async getStaff(@Param() { id }: IdParamDto): Promise<StaffDto> {
    const staff = await this.staffService.findById(id);
    if (!staff) {
      throw AppException.notFound("Staff member");
    }
    return staff as StaffDto;
  }

  @Patch(":id")
  @RequirePermissions("staff:write")
  async updateStaff(@Param() { id }: IdParamDto, @Body() input: UpdateStaffDto, @CurrentActor() actor: Actor): Promise<StaffDto> {
    if (actor.kind !== "staff") {
      throw AppException.unauthorized();
    }

    const isOwner = actor.roles.includes("owner");
    return (await this.staffService.update(id, input, actor.staffId, isOwner)) as StaffDto;
  }

  @Delete(":id")
  @RequirePermissions("staff:write")
  async deleteStaff(@Param() { id }: IdParamDto, @CurrentActor() actor: Actor): Promise<void> {
    if (actor.kind !== "staff") {
      throw AppException.unauthorized();
    }

    await this.staffService.deactivate(id, actor.staffId, actor.roles.includes("owner"));
  }
}
