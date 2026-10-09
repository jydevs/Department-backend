import { Controller, Get, Query } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditLog } from "../identity/entities";
import { RequirePermissions } from "../common/auth/decorators";
import { AuditQueryDto, decodeAuditCursor } from "./dto/audit-query.dto";
import { AuditLogResponseDto } from "./dto/audit-log.dto";
import { CursorPage, toCursorPage } from "../common/pagination/pagination";

@Controller("admin/audit-logs")
export class AuditController {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  @Get()
  @RequirePermissions("audit:read")
  async getAuditLogs(@Query() query: AuditQueryDto): Promise<CursorPage<AuditLogResponseDto>> {
    const { limit, cursor, entityType, actorId } = query;

    let cursorData: { c: string; id: string } | undefined;
    if (cursor) {
      cursorData = decodeAuditCursor(cursor);
    }

    const queryBuilder = this.auditRepository.createQueryBuilder("log");

    if (entityType) {
      queryBuilder.andWhere("log.entityType = :entityType", { entityType });
    }

    if (actorId) {
      queryBuilder.andWhere("log.actorId = :actorId", { actorId });
    }

    if (cursorData) {
      queryBuilder.andWhere("(log.createdAt, log.id) < (:createdAt, :id)", {
        createdAt: cursorData.c,
        id: cursorData.id,
      });
    }

    const rows = await queryBuilder
      .orderBy("log.createdAt", "DESC")
      .addOrderBy("log.id", "DESC")
      .take(limit + 1)
      .getMany();

    return toCursorPage(rows.map((r) => this.mapToDto(r)), limit, (last) => ({
      c: last.createdAt.toISOString(),
      id: last.id,
    }));
  }

  private mapToDto(log: AuditLog): AuditLogResponseDto {
    return {
      id: log.id,
      actorType: log.actorType,
      actorId: log.actorId ?? null,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId ?? null,
      diff: log.diff ?? null,
      requestId: log.requestId ?? null,
      ip: log.ip ?? null,
      createdAt: log.createdAt,
    } as AuditLogResponseDto;
  }
}
