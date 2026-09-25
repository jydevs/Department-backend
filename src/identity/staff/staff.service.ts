import { randomInt } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { hash } from "argon2";
import { v7 as uuidv7 } from "uuid";
import { StaffUser, Role, RefreshToken } from "../entities";
import { AppException } from "../../common/errors/app-exception";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { StaffCreateInput } from "./dto/staff-create.dto";
import { StaffUpdateInput } from "./dto/staff-update.dto";
import { StaffResponseDto } from "./dto/staff-response.dto";

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(StaffUser)
    private readonly staffRepository: Repository<StaffUser>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
  ) {}

  async create(input: StaffCreateInput, actorIsOwner: boolean): Promise<{ staff: StaffResponseDto; password: string }> {
    const tempPassword = this.generateTemporaryPassword();
    const passwordHash = await hash(tempPassword, {
      type: 2, // argon2id
      memoryCost: 19456, // 19 MiB
      timeCost: 2,
      parallelism: 1,
    });

    const result = await this.transactionService.run(async (manager) => {
      const roleRepo = manager.getRepository(Role);
      const staffRepo = manager.getRepository(StaffUser);

      const role = await roleRepo.findOne({ where: { id: input.roleId } });
      if (!role) {
        throw AppException.notFound("Role");
      }

      if (role.key === "owner" && !actorIsOwner) {
        throw AppException.forbidden("Only owners can assign the owner role");
      }

      const existingStaff = await staffRepo.findOne({ where: { email: input.email.toLowerCase() } });
      if (existingStaff) {
        throw AppException.conflict("STAFF_EXISTS", "Staff member with this email already exists");
      }

      const staff = new StaffUser();
      staff.id = uuidv7();
      staff.email = input.email.toLowerCase();
      staff.fullName = input.fullName;
      staff.passwordHash = passwordHash;
      staff.roleId = input.roleId;
      staff.isActive = true;

      const savedStaff = await staffRepo.save(staff);

      await this.auditService.record(
        {
          action: "staff:create",
          entityType: "StaffUser",
          entityId: savedStaff.id,
          diff: {
            email: savedStaff.email,
            fullName: savedStaff.fullName,
            roleId: savedStaff.roleId,
          },
        },
        manager,
      );

      return savedStaff;
    });

    return {
      staff: this.mapToDto(result),
      password: tempPassword,
    };
  }

  async update(id: string, input: StaffUpdateInput, actorId: string, actorIsOwner: boolean): Promise<StaffResponseDto> {
    return this.transactionService.run(async (manager) => {
      const staffRepo = manager.getRepository(StaffUser);
      const roleRepo = manager.getRepository(Role);

      // Serialize every change that can touch owners: lock the active owner rows before counting them,
      // otherwise two owners demoting each other at the same time would both see "2 owners left".
      const ownerRole = await roleRepo.findOne({ where: { key: "owner" } });
      if (ownerRole) {
        await manager.query("SELECT id FROM staff_users WHERE role_id = $1 AND is_active = true FOR UPDATE", [ownerRole.id]);
      }

      const staff = await staffRepo.findOne({ where: { id } });
      if (!staff) throw AppException.notFound("Staff member");

      const isOwnerTarget = !!ownerRole && staff.roleId === ownerRole.id;
      if (isOwnerTarget && !actorIsOwner) throw AppException.forbidden("Only owners can modify an owner");

      if (input.roleId !== undefined && input.roleId !== staff.roleId) {
        if (staff.id === actorId) throw AppException.forbidden("Cannot change your own role");
        const newRole = await roleRepo.findOne({ where: { id: input.roleId } });
        if (!newRole) throw AppException.notFound("Role");
        if (newRole.key === "owner" && !actorIsOwner) throw AppException.forbidden("Only owners can assign the owner role");
      }

      if (input.isActive === false && staff.id === actorId) throw AppException.forbidden("Cannot deactivate yourself");

      const losesOwnerSeat = isOwnerTarget && staff.isActive && ((input.roleId !== undefined && input.roleId !== staff.roleId) || input.isActive === false);
      if (losesOwnerSeat) {
        const owners = await staffRepo.count({ where: { roleId: staff.roleId, isActive: true } });
        if (owners <= 1) throw AppException.forbidden("Cannot demote or deactivate the last active owner");
      }

      if (input.isActive === false) {
        await manager.getRepository(RefreshToken).update({ staffUserId: staff.id }, { revokedAt: new Date() });
      }

      const diff: Record<string, unknown> = {};
      if (input.fullName !== undefined && input.fullName !== staff.fullName) {
        diff.fullName = { old: staff.fullName, new: input.fullName };
        staff.fullName = input.fullName;
      }
      if (input.roleId !== undefined && input.roleId !== staff.roleId) {
        diff.roleId = { old: staff.roleId, new: input.roleId };
        staff.roleId = input.roleId;
      }
      if (input.isActive !== undefined && input.isActive !== staff.isActive) {
        diff.isActive = { old: staff.isActive, new: input.isActive };
        staff.isActive = input.isActive;
      }

      const updated = await staffRepo.save(staff);
      if (Object.keys(diff).length > 0) {
        await this.auditService.record({ action: "staff:update", entityType: "StaffUser", entityId: updated.id, diff }, manager);
      }
      return this.mapToDto(updated);
    });
  }

  async deactivate(id: string, actorId: string, actorIsOwner: boolean): Promise<void> {
    await this.update(id, { isActive: false }, actorId, actorIsOwner);
  }

  async findById(id: string): Promise<StaffResponseDto | null> {
    const staff = await this.staffRepository.findOne({ where: { id } });
    return staff ? this.mapToDto(staff) : null;
  }

  async list(page: number, pageSize: number): Promise<{ items: StaffResponseDto[]; total: number }> {
    const [items, total] = await this.staffRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { createdAt: "DESC" },
    });

    return {
      items: items.map((s) => this.mapToDto(s)),
      total,
    };
  }

  private mapToDto(staff: StaffUser): StaffResponseDto {
    return {
      id: staff.id,
      email: staff.email,
      fullName: staff.fullName,
      isActive: staff.isActive,
      roleId: staff.roleId,
      totpEnabled: staff.totpEnabled,
      lastLoginAt: staff.lastLoginAt ?? null,
      createdAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    };
  }

  private generateTemporaryPassword(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*";
    return Array.from({ length: 20 }, () => chars[randomInt(chars.length)]).join("");
  }
}
