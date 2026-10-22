import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditService } from "../audit/audit.service";
import { RequestContextStore } from "../common/context/request-context";
import { AppException } from "../common/errors/app-exception";
import { OffsetPage, toOffsetPage } from "../common/pagination/pagination";
import { escapeLike } from "../common/sql/escape-like";
import { TransactionService } from "../database/transaction.service";
import { ContactMessage } from "./entities";
import { truncateIp } from "./ip-truncate";
import type { ContactMessageListQueryDto, ContactMessageResponse, CreateContactMessageDto } from "./marketing.dto";

@Injectable()
export class ContactService {
  constructor(
    @InjectRepository(ContactMessage) private readonly messages: Repository<ContactMessage>,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateContactMessageDto): Promise<void> {
    if (input.website !== undefined && input.website.trim() !== "") return; // honeypot: pretend success, store nothing
    await this.messages.save(
      this.messages.create({
        name: input.name,
        email: input.email,
        subject: input.subject ?? null,
        phone: input.phone ?? null,
        message: input.message,
        status: "new",
        ip: truncateIp(RequestContextStore.get()?.ip),
      }),
    );
  }

  async list(query: ContactMessageListQueryDto): Promise<OffsetPage<ContactMessageResponse>> {
    const qb = this.messages.createQueryBuilder("m");
    if (query.status) qb.andWhere("m.status = :status", { status: query.status });
    if (query.q) {
      qb.andWhere("(m.email ILIKE :q ESCAPE '\\' OR m.name ILIKE :q ESCAPE '\\' OR m.subject ILIKE :q ESCAPE '\\')", {
        q: `%${escapeLike(query.q)}%`,
      });
    }
    const [rows, total] = await qb
      .orderBy("m.createdAt", "DESC")
      .addOrderBy("m.id", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return toOffsetPage(rows.map(toResponse), total, query.page, query.pageSize);
  }

  async updateStatus(id: string, status: string): Promise<ContactMessageResponse> {
    return this.tx.run(async (manager) => {
      const row = await manager.findOne(ContactMessage, { where: { id }, lock: { mode: "pessimistic_write" } });
      if (!row) throw AppException.notFound("Contact message");
      const previous = row.status;
      row.status = status;
      await manager.save(row);
      await this.audit.record({ action: "contact_message.update", entityType: "contact_message", entityId: id, diff: { from: previous, to: status } }, manager);
      return toResponse(row);
    });
  }

  async remove(id: string): Promise<void> {
    await this.tx.run(async (manager) => {
      const result = await manager.delete(ContactMessage, { id });
      if (!result.affected) throw AppException.notFound("Contact message");
      await this.audit.record({ action: "contact_message.delete", entityType: "contact_message", entityId: id }, manager);
    });
  }
}

function toResponse(row: ContactMessage): ContactMessageResponse {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject ?? null,
    phone: row.phone ?? null,
    message: row.message,
    status: row.status,
    ip: row.ip ?? null,
    createdAt: row.createdAt,
  };
}
