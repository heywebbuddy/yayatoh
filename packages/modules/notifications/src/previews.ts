import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, gt, lt } from 'drizzle-orm';
import { z } from 'zod';
import { requireUser } from './preferences.ts';
import { emailPreviews } from './schema.ts';

/** How long a stored preview can be opened. */
export const PREVIEW_TTL_MS = 10 * 60 * 1000;
export const PREVIEW_MAX_BYTES = 512 * 1024;

/**
 * The headers a stored email preview is served with (M1.10d). The console's strict CSP forbids
 * style attributes, and an `srcdoc` frame inherits it, so emails (inline styles, by necessity)
 * rendered unstyled. The preview is served from its own same-origin URL instead, under a policy of
 * its own: nothing but inline styles and https/data images, sandboxed (no scripts, forms or
 * navigation, opaque origin), framable only by our own pages.
 */
export const PREVIEW_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'private, no-store',
};

/**
 * Keep a rendered email (server-rendered by our templates) for ten minutes and return its id. The
 * draft never travels in a URL; only the member who stored it can open it. Expired previews of
 * the org are purged on the way.
 */
export const storeEmailPreviewCommand = tenantCommand({
  name: 'notifications.storeEmailPreview',
  input: z.object({ html: z.string().min(1).max(PREVIEW_MAX_BYTES) }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const userId = requireUser(ctx);
    await tx.delete(emailPreviews).where(lt(emailPreviews.expiresAt, ctx.now));
    const [row] = await tx
      .insert(emailPreviews)
      .values({
        orgId: requireOrg(ctx),
        createdBy: userId,
        html: input.html,
        expiresAt: new Date(ctx.now.getTime() + PREVIEW_TTL_MS),
      })
      .returning({ id: emailPreviews.id });
    if (!row) throw new DomainError('internal');
    return { id: row.id };
  },
});

/** The stored preview's HTML: the creator's own, unexpired, in this org; otherwise not found. */
export const emailPreviewQuery = tenantQuery({
  name: 'notifications.emailPreview',
  input: z.object({ id: z.uuid() }),
  output: z.object({ html: z.string() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const userId = requireUser(ctx);
    const [row] = await tx
      .select({ html: emailPreviews.html })
      .from(emailPreviews)
      .where(
        and(
          eq(emailPreviews.id, input.id),
          eq(emailPreviews.createdBy, userId),
          gt(emailPreviews.expiresAt, ctx.now),
        ),
      );
    if (!row) throw new DomainError('not_found');
    return row;
  },
});
