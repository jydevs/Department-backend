import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, EntityManager } from "typeorm";
import { AuditLog } from "../identity/entities";
import { RequestContextStore } from "../common/context/request-context";

interface RecordInput {
  action: string;
  entityType: string;
  entityId?: string;
  diff?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  async record(input: RecordInput, manager?: EntityManager): Promise<void> {
    const context = RequestContextStore.get();

    const repository = manager ? manager.getRepository(AuditLog) : this.auditRepository;

    await repository.save(repository.create({
      actorType: context?.actor.kind ?? "anonymous",
      actorId: context?.actor.kind === "staff" ? context.actor.staffId : null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      diff: input.diff ?? null,
      requestId: context?.requestId,
      ip: context?.ip,
    }));
  }
}
