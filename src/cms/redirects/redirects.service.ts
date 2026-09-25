import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { AppException } from "../../common/errors/app-exception";
import { OffsetPage, toOffsetPage } from "../../common/pagination/pagination";
import { escapeLike } from "../../common/sql/escape-like";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { RevalidationService } from "../content/revalidation.service";
import { isUniqueViolation } from "../content/content.util";
import { Redirect } from "../entities";
import { isSafeUrl } from "../schemas/common";
import type { RedirectCreateDto, RedirectResponseDto, RedirectUpdateDto, StorefrontRedirectDto } from "./redirects.dto";

const MAX_CHAIN = 10;
const MAX_STOREFRONT_REDIRECTS = 5000;
const REDIRECTS_TAG = "redirects";

function invalid(path: string, message: string): AppException {
  return AppException.badRequest("VALIDATION_ERROR", message, [{ path, message }]);
}

/** `/About/?utm=1#x` -> `/about`. Starts with `/`, no query/hash, lowercase, no trailing slash (except root). */
export function normalizePath(input: string, field: string): string {
  let p = input.trim();
  const cut = p.search(/[?#]/);
  if (cut !== -1) p = p.slice(0, cut);
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("\\")) {
    throw invalid(field, "Debe empezar por / (una sola barra) y no contener \\");
  }
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) throw invalid(field, "No se permiten espacios ni caracteres de control");
  }
  p = p.toLowerCase().replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.length === 0 ? "/" : p;
}

/** Destination: internal `/path` (query allowed) or `https://` URL. Returns the value to store and its normalized internal path (null if external). */
function normalizeTarget(input: string): { value: string; internal: string | null } {
  const v = input.trim();
  if (v.startsWith("/")) {
    if (!isSafeUrl(v, { allowMailTel: false })) throw invalid("toPath", "Destino inválido");
    return { value: v, internal: normalizePath(v, "toPath") };
  }
  if (!isSafeUrl(v, { allowMailTel: false })) throw invalid("toPath", "Destino inválido: use /ruta o https://");
  return { value: v, internal: null };
}

@Injectable()
export class RedirectsService {
  constructor(
    @InjectRepository(Redirect) private readonly redirects: Repository<Redirect>,
    private readonly tx: TransactionService,
    private readonly audit: AuditService,
    private readonly revalidation: RevalidationService,
  ) {}

  async list(page: number, pageSize: number, q: string | undefined): Promise<OffsetPage<RedirectResponseDto>> {
    const qb = this.redirects.createQueryBuilder("r").orderBy("r.createdAt", "DESC").addOrderBy("r.id", "DESC");
    if (q) {
      const like = `%${escapeLike(q.toLowerCase())}%`;
      qb.where("(LOWER(r.fromPath) LIKE :like ESCAPE '\\' OR LOWER(r.toPath) LIKE :like ESCAPE '\\')", { like });
    }
    const [rows, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return toOffsetPage(
      rows.map((r) => this.toDto(r)),
      total,
      page,
      pageSize,
    );
  }

  async get(id: string): Promise<RedirectResponseDto> {
    const r = await this.redirects.findOne({ where: { id } });
    if (!r) throw AppException.notFound("Redirect");
    return this.toDto(r);
  }

  async create(input: RedirectCreateDto): Promise<RedirectResponseDto> {
    const from = normalizePath(input.fromPath, "fromPath");
    const target = normalizeTarget(input.toPath);
    const dto = await this.tx.run(async (manager) => {
      await this.assertNoLoop(manager, from, target.internal, null);
      const redirect = manager.create(Redirect, { fromPath: from, toPath: target.value, statusCode: input.statusCode, isActive: input.isActive, hits: 0 });
      try {
        await manager.insert(Redirect, redirect);
      } catch (err) {
        if (isUniqueViolation(err)) throw AppException.conflict("CONFLICT", `Ya existe una redirección desde "${from}"`);
        throw err;
      }
      await this.audit.record(
        { action: "redirect:create", entityType: "Redirect", entityId: redirect.id, diff: { fromPath: from, toPath: target.value, statusCode: input.statusCode } },
        manager,
      );
      return this.toDto(await manager.findOneByOrFail(Redirect, { id: redirect.id }));
    });
    void this.revalidation.notify([REDIRECTS_TAG]);
    return dto;
  }

  async update(id: string, input: RedirectUpdateDto): Promise<RedirectResponseDto> {
    const dto = await this.tx.run(async (manager) => {
      const r = await manager.findOne(Redirect, { where: { id }, lock: { mode: "pessimistic_write" } });
      if (!r) throw AppException.notFound("Redirect");
      const diff: Record<string, unknown> = {};
      if (input.fromPath !== undefined) {
        const from = normalizePath(input.fromPath, "fromPath");
        if (from !== r.fromPath) {
          diff.fromPath = { old: r.fromPath, new: from };
          r.fromPath = from;
        }
      }
      let internal: string | null;
      if (input.toPath !== undefined) {
        const target = normalizeTarget(input.toPath);
        if (target.value !== r.toPath) {
          diff.toPath = { old: r.toPath, new: target.value };
          r.toPath = target.value;
        }
        internal = target.internal;
      } else {
        internal = r.toPath.startsWith("/") ? normalizePath(r.toPath, "toPath") : null;
      }
      if (input.statusCode !== undefined && input.statusCode !== r.statusCode) {
        diff.statusCode = { old: r.statusCode, new: input.statusCode };
        r.statusCode = input.statusCode;
      }
      if (input.isActive !== undefined && input.isActive !== r.isActive) {
        diff.isActive = { old: r.isActive, new: input.isActive };
        r.isActive = input.isActive;
      }
      await this.assertNoLoop(manager, r.fromPath, internal, r.id);
      let saved: Redirect;
      try {
        saved = await manager.save(Redirect, r);
      } catch (err) {
        if (isUniqueViolation(err)) throw AppException.conflict("CONFLICT", `Ya existe una redirección desde "${r.fromPath}"`);
        throw err;
      }
      if (Object.keys(diff).length > 0) {
        await this.audit.record({ action: "redirect:update", entityType: "Redirect", entityId: id, diff }, manager);
      }
      return this.toDto(saved);
    });
    void this.revalidation.notify([REDIRECTS_TAG]);
    return dto;
  }

  async remove(id: string): Promise<void> {
    await this.tx.run(async (manager) => {
      const r = await manager.findOne(Redirect, { where: { id } });
      if (!r) throw AppException.notFound("Redirect");
      await manager.delete(Redirect, { id });
      await this.audit.record({ action: "redirect:delete", entityType: "Redirect", entityId: id, diff: { fromPath: r.fromPath, toPath: r.toPath } }, manager);
    });
    void this.revalidation.notify([REDIRECTS_TAG]);
  }

  /** Active redirects for the storefront middleware. */
  async listActive(): Promise<StorefrontRedirectDto[]> {
    const rows = await this.redirects.find({
      where: { isActive: true },
      order: { fromPath: "ASC" },
      take: MAX_STOREFRONT_REDIRECTS,
      select: { fromPath: true, toPath: true, statusCode: true },
    });
    return rows.map((r) => ({ from: r.fromPath, to: r.toPath, status: r.statusCode }));
  }

  /** Rejects from == to and any chain (A -> B -> ... -> A) through active redirects, up to MAX_CHAIN hops. */
  private async assertNoLoop(manager: EntityManager, from: string, targetInternal: string | null, selfId: string | null): Promise<void> {
    if (targetInternal === null) return;
    let current: string = targetInternal;
    for (let hop = 0; hop <= MAX_CHAIN; hop++) {
      if (current === from) throw invalid("toPath", "La redirección crea un bucle");
      const rows: { to_path: string }[] = await manager.query(
        `SELECT to_path FROM redirects WHERE from_path = $1 AND is_active = true AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
        [current, selfId],
      );
      const next = rows[0]?.to_path;
      if (!next || !next.startsWith("/")) return;
      current = normalizePath(next, "toPath");
    }
  }

  private toDto(r: Redirect): RedirectResponseDto {
    return {
      id: r.id,
      fromPath: r.fromPath,
      toPath: r.toPath,
      statusCode: r.statusCode,
      isActive: r.isActive,
      hits: r.hits,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
