import { Controller, Get } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Role } from "../entities";
import { RequirePermissions } from "../../common/auth/decorators";
import { RoleDto } from "./dto/role-response.dto";

@Controller("admin/roles")
export class RolesController {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  @Get()
  @RequirePermissions("roles:read")
  async listRoles(): Promise<RoleDto[]> {
    const roles = await this.roleRepository.find({ order: { name: "ASC" } });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      permissions: r.permissions,
      isSystem: r.isSystem,
    })) as RoleDto[];
  }
}
