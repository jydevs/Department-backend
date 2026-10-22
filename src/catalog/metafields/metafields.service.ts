import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, EntityManager, IsNull } from "typeorm";
import { Metafield } from "../entities/metafield.entity";
import { Product } from "../entities/product.entity";
import { Collection } from "../entities/collection.entity";
import { AppException } from "../../common/errors/app-exception";
import { TransactionService } from "../../database/transaction.service";
import { AuditService } from "../../audit/audit.service";
import { MetafieldInput, MetafieldOwnerType, MetafieldResponseDto } from "./dto/metafield.dto";

@Injectable()
export class MetafieldsService {
  constructor(
    @InjectRepository(Metafield)
    private readonly metafieldRepository: Repository<Metafield>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Collection)
    private readonly collectionRepository: Repository<Collection>,
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
  ) {}

  async getMetafields(ownerType: MetafieldOwnerType, ownerId: string): Promise<MetafieldResponseDto[]> {
    await this.verifyOwnerExists(ownerType, ownerId, this.metafieldRepository.manager);

    const metafields = await this.metafieldRepository.find({
      where: { ownerType, ownerId },
      order: { namespace: "ASC", key: "ASC" },
    });

    return metafields.map((m): MetafieldResponseDto => this.mapToDto(m));
  }

  async upsertMetafields(
    ownerType: MetafieldOwnerType,
    ownerId: string,
    inputs: MetafieldInput[],
  ): Promise<MetafieldResponseDto[]> {
    return this.transactionService.run(async (manager) => {
      const metaRepo = manager.getRepository(Metafield);

      // Verify owner exists
      await this.verifyOwnerExists(ownerType, ownerId, manager);

      const results: MetafieldResponseDto[] = [];

      for (const input of inputs) {
        // Validate value based on type
        this.validateMetafieldValue(input.type, input.value);

        // Upsert by namespace + key
        const existing = await metaRepo.findOne({
          where: { ownerType, ownerId, namespace: input.namespace, key: input.key },
        });

        let metafield: Metafield;
        const isNew = !existing;

        if (isNew) {
          metafield = new Metafield();
          metafield.ownerType = ownerType;
          metafield.ownerId = ownerId;
          metafield.namespace = input.namespace;
          metafield.key = input.key;
          metafield.type = input.type;
          metafield.value = input.value;
        } else {
          metafield = existing;
          metafield.type = input.type;
          metafield.value = input.value;
        }

        const saved = await metaRepo.save(metafield);

        await this.auditService.record(
          {
            action: isNew ? "metafield:create" : "metafield:update",
            entityType: "Metafield",
            entityId: saved.id,
            diff: isNew ? { value: input.value } : { before: existing?.value, after: input.value },
          },
          manager,
        );

        results.push(this.mapToDto(saved));
      }

      return results;
    });
  }

  async deleteMetafield(ownerType: MetafieldOwnerType, ownerId: string, namespace: string, key: string): Promise<void> {
    await this.transactionService.run(async (manager) => {
      await this.verifyOwnerExists(ownerType, ownerId, manager);

      const metaRepo = manager.getRepository(Metafield);
      const existing = await metaRepo.findOne({ where: { ownerType, ownerId, namespace, key } });
      if (!existing) throw AppException.notFound("Metafield");

      await metaRepo.delete({ id: existing.id });

      await this.auditService.record(
        {
          action: "metafield:delete",
          entityType: "Metafield",
          entityId: existing.id,
          diff: { ownerType, ownerId, namespace, key, type: existing.type, value: existing.value },
        },
        manager,
      );
    });
  }

  private validateMetafieldValue(type: string, value: string): void {
    if (value.length > 5000) {
      throw AppException.badRequest("VALUE_TOO_LONG", "Metafield value must be <= 5000 characters");
    }

    switch (type) {
      case "number_integer":
        if (!Number.isInteger(Number(value))) {
          throw AppException.badRequest("INVALID_VALUE", "Value must be a valid integer");
        }
        break;

      case "number_decimal":
        if (isNaN(Number(value))) {
          throw AppException.badRequest("INVALID_VALUE", "Value must be a valid decimal number");
        }
        break;

      case "boolean":
        if (value !== "true" && value !== "false") {
          throw AppException.badRequest("INVALID_VALUE", "Value must be 'true' or 'false'");
        }
        break;

      case "json":
        try {
          JSON.parse(value);
          if (Buffer.byteLength(value, "utf8") > 10240) {
            throw AppException.badRequest("INVALID_VALUE", "JSON value must be <= 10KB");
          }
        } catch {
          throw AppException.badRequest("INVALID_VALUE", "Value must be valid JSON");
        }
        break;

      case "url":
        try {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol)) {
            throw AppException.badRequest("INVALID_VALUE", "URL must use http or https protocol");
          }
        } catch {
          throw AppException.badRequest("INVALID_VALUE", "Value must be a valid URL");
        }
        break;

      case "color":
        if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
          throw AppException.badRequest("INVALID_VALUE", "Color must be in #RRGGBB format");
        }
        break;

      case "single_line_text":
      case "multi_line_text":
        // No specific validation needed
        break;

      default:
        throw AppException.badRequest("INVALID_TYPE", `Unknown metafield type: ${type}`);
    }
  }

  private async verifyOwnerExists(ownerType: MetafieldOwnerType, ownerId: string, manager: EntityManager): Promise<void> {
    const where = { id: ownerId, deletedAt: IsNull() };
    const exists =
      ownerType === "product"
        ? await manager.getRepository(Product).exists({ where })
        : await manager.getRepository(Collection).exists({ where });

    if (!exists) {
      throw AppException.notFound(ownerType === "product" ? "Product" : "Collection");
    }
  }

  private mapToDto(metafield: Metafield): MetafieldResponseDto {
    return {
      id: metafield.id,
      ownerType: metafield.ownerType === "collection" ? "collection" : "product",
      ownerId: metafield.ownerId,
      namespace: metafield.namespace,
      key: metafield.key,
      type: metafield.type,
      value: metafield.value,
      createdAt: metafield.createdAt,
      updatedAt: metafield.updatedAt,
    };
  }
}
