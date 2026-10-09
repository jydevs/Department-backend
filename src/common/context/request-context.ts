import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../auth/actor";

export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent?: string;
  actor: Actor;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Read-anywhere request context (audit log, logging, idempotency) without threading `req` through services. */
export const RequestContextStore = {
  get: (): RequestContext | undefined => storage.getStore(),
  /** Called by the auth guard once the caller is known. */
  setActor(actor: Actor) {
    const s = storage.getStore();
    if (s) s.actor = actor;
  },
};

export function requestContextMiddleware(req: Request & { id?: string | number }, _res: Response, next: NextFunction) {
  storage.run(
    {
      requestId: req.id !== undefined ? String(req.id) : "unknown",
      ip: req.ip ?? "unknown",
      userAgent: req.headers["user-agent"]?.slice(0, 300),
      actor: { kind: "anonymous" },
    },
    next,
  );
}
