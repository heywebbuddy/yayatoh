import { DomainError } from './errors.ts';

export type Actor =
  | { readonly type: 'user'; readonly userId: string }
  | { readonly type: 'api_key'; readonly keyId: string }
  | { readonly type: 'system'; readonly name: string }
  | { readonly type: 'anonymous' };

/**
 * Request context. `orgId` comes from the route's root param or the authenticated
 * session/token — never from request headers (CLAUDE.md, tenancy rules).
 */
export interface Ctx {
  readonly requestId: string;
  readonly orgId: string | null;
  readonly actor: Actor;
  readonly locale: string;
  readonly now: Date;
  /** Time of the actor's last step-up (re-auth) in this session, if any. */
  readonly stepUpAt: Date | null;
  /** Client-supplied `Idempotency-Key` for this write, if any. */
  readonly idempotencyKey: string | null;
}

export interface CtxInit {
  orgId?: string | null;
  actor?: Actor;
  locale?: string;
  now?: Date;
  requestId?: string;
  stepUpAt?: Date | null;
  idempotencyKey?: string | null;
}

const ANONYMOUS: Actor = { type: 'anonymous' };

export function createCtx(init: CtxInit = {}): Ctx {
  return Object.freeze<Ctx>({
    requestId: init.requestId ?? crypto.randomUUID(),
    orgId: init.orgId ?? null,
    actor: init.actor ?? ANONYMOUS,
    locale: init.locale ?? 'en',
    now: init.now ?? new Date(),
    stepUpAt: init.stepUpAt ?? null,
    idempotencyKey: init.idempotencyKey ?? null,
  });
}

/** The tenant for this context, or a DomainError if the context is not tenant-scoped. */
export function requireOrg(ctx: Ctx): string {
  if (!ctx.orgId) throw new DomainError('forbidden', 'Tenant context required');
  return ctx.orgId;
}

export function actorId(actor: Actor): string {
  switch (actor.type) {
    case 'user':
      return `user:${actor.userId}`;
    case 'api_key':
      return `api_key:${actor.keyId}`;
    case 'system':
      return `system:${actor.name}`;
    case 'anonymous':
      return 'anonymous';
  }
}
