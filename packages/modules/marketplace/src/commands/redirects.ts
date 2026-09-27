import { isUniqueViolation } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { normalizeHostname } from '@yayatoh/tenancy';
import { z } from 'zod';
import { normalizePath } from '../domain/redirects.ts';
import { legacyRedirects, REDIRECT_MATCHES, REDIRECT_STATUSES } from '../schema.ts';

export const LegacyRedirectInput = z.object({
  /** A hostname, or `*` for every platform host. */
  host: z.string().min(1).max(253),
  source: z.string().regex(/^\//).max(2000),
  match: z.enum(REDIRECT_MATCHES).default('exact'),
  target: z
    .string()
    .regex(/^(\/(?!\/)|https:\/\/)/, 'A path or an https:// URL')
    .max(2000),
  status: z.literal(REDIRECT_STATUSES).default(308),
});

export const LegacyRedirectDto = z.object({
  id: z.uuid(),
  host: z.string(),
  source: z.string(),
  match: z.enum(REDIRECT_MATCHES),
  target: z.string(),
  status: z.number().int(),
});

/**
 * Register a legacy URL (roadmap §7.7). Migration tooling only: needs a platform permission,
 * which org roles never grant. A URL on a host goes to one place: a duplicate is a conflict.
 */
export const addLegacyRedirectCommand = tenantCommand({
  name: 'marketplace.addLegacyRedirect',
  input: LegacyRedirectInput,
  output: LegacyRedirectDto,
  entitlement: 'core',
  permission: 'platform:redirects.manage',
  handler: async ({ input, ctx, tx }) => {
    const host = input.host === '*' ? '*' : normalizeHostname(input.host);
    if (!host) throw new DomainError('validation_failed', 'Not a hostname', { field: 'host' });
    const source = normalizePath(input.source);
    if (input.target === source)
      throw new DomainError('validation_failed', 'A redirect cannot point at itself');
    try {
      const [row] = await tx
        .insert(legacyRedirects)
        .values({
          orgId: requireOrg(ctx),
          host,
          source,
          match: input.match,
          target: input.target,
          status: input.status,
        })
        .returning();
      if (!row) throw new DomainError('internal');
      return { ...row, match: row.match as 'exact' | 'prefix' };
    } catch (err) {
      if (isUniqueViolation(err, 'legacy_redirects_host_source_key'))
        throw new DomainError('conflict', 'This URL already redirects', { field: 'source' });
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'marketplace.legacy_redirect.add',
    targetType: 'legacy_redirect',
    targetId: row.id,
    data: { host: input.host, source: input.source, target: input.target },
  }),
});
