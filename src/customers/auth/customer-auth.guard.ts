import { applyDecorators, CanActivate, createParamDecorator, ExecutionContext, Injectable, UseGuards } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Request } from "express";
import { Repository } from "typeorm";
import { Public } from "../../common/auth/decorators";
import type { Actor } from "../../common/auth/actor";
import { RequestContextStore } from "../../common/context/request-context";
import { AppException } from "../../common/errors/app-exception";
import { Customer } from "../entities";
import { CustomerTokenService } from "./customer-token.service";

type CustomerRequest = Request & { actor?: Actor; customer?: { id: string } };

/**
 * Resolves a customer access token to a live customer id. The customer is reloaded on every call:
 * deactivated, anonymized or deleted accounts lose access immediately. Returns null for anything invalid.
 */
@Injectable()
export class CustomerSessionService {
  constructor(
    private readonly tokens: CustomerTokenService,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  async resolve(authorization: string | undefined): Promise<string | null> {
    if (!authorization || !authorization.startsWith("Bearer ")) return null;

    const customerId = await this.tokens.verify(authorization.slice(7));
    if (!customerId) return null;

    // soft-deleted rows are excluded by TypeORM; a malformed id cannot reach here (the JWT was signed by us)
    const customer = await this.customers.findOne({
      where: { id: customerId },
      select: { id: true, isActive: true, anonymizedAt: true },
    });
    if (!customer || !customer.isActive || customer.anonymizedAt) return null;
    return customer.id;
  }
}

/** Authenticates storefront customers by their own Bearer JWT (aud storefront, typ customer). */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly sessions: CustomerSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CustomerRequest>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) throw AppException.unauthorized("Missing or invalid authorization header");

    const customerId = await this.sessions.resolve(header);
    if (!customerId) throw AppException.unauthorized("Invalid or expired token");

    const customer = { id: customerId };
    const actor: Actor = { kind: "customer", customerId: customer.id };
    req.customer = { id: customer.id };
    req.actor = actor;
    RequestContextStore.setActor(actor);
    return true;
  }
}

/**
 * Marks a route as customer-authenticated: @Public() makes the global staff guard step aside
 * and CustomerAuthGuard takes over.
 */
export const CustomerAuth = () => applyDecorators(Public(), UseGuards(CustomerAuthGuard));

/** Injects the authenticated customer's id. Only valid on @CustomerAuth() routes. */
export const CurrentCustomerId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<CustomerRequest>();
  if (!req.customer) throw AppException.unauthorized();
  return req.customer.id;
});
