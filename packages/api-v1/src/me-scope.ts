import { createCtx, DomainError } from '@yayatoh/kernel';
import { createMiddleware } from 'hono/factory';
import type { V1Env } from './context.ts';

/**
 * The `/me/…` scope (M7.2a): routes for a signed-in person rather than an organization. Mount
 * person routes under `/me/` and read `c.get('me')`; the middleware has already checked that:
 *  - the credential is a user's bearer session (an API key is not a person: 401);
 *  - the session's email is verified (403 `forbidden`, `details.reason: email_unverified`). The app
 *    sign-in grants all verify the address (an emailed code, a provider's verified email), so only
 *    a password account that never verified its email is refused. Everything under `/me/` is keyed
 *    by that email (my tickets), so an unproven address must not read it.
 *
 * `/me` and `/me/organizations` (M1.2a) predates the scope and stays open to unverified sessions.
 */
export const meScope = createMiddleware<V1Env>(async (c, next) => {
  const p = c.get('principal');
  if (p?.kind !== 'user') throw new DomainError('unauthenticated', 'A user session is required');
  const session = p.session;
  if (!session.user.emailVerified)
    throw new DomainError('forbidden', 'Verify your email address to use this', {
      reason: 'email_unverified',
    });
  const ctx = createCtx({
    orgId: null,
    requestId: c.get('requestId'),
    actor: { type: 'user', userId: session.user.id },
    locale: (c.req.header('accept-language') ?? 'en').split(/[,;]/)[0]?.trim() || 'en',
    stepUpAt: session.stepUpAt,
    idempotencyKey: c.req.header('idempotency-key') ?? null,
  });
  c.set('me', { session, user: session.user, ctx });
  c.set('ctx', ctx);
  await next();
});

/** `/me/…` paths that predate the scope and keep answering unverified sessions. */
const OPEN_ME_PATHS: readonly string[] = ['/me', '/me/', '/me/organizations'];

/** Whether the path (without the mount prefix) is one the scope guards. */
export const isGuardedMePath = (path: string): boolean => !OPEN_ME_PATHS.includes(path);
