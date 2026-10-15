import 'server-only';
import { type Ctx, executeQuery } from '@yayatoh/kernel';
import { roleRequiresTwoFactor, twoFactorPolicyQuery } from '@yayatoh/tenancy';
import { ports } from './ports.ts';

/**
 * Whether this org role must have two-step verification on before acting (decision D14): owners,
 * admins and finance, unless the org switched its requirement off (Settings → Security, or staff).
 * `ctx` is the member's context in that org. An agency with the client's finance access counts as
 * finance (M6.7a): the client's setting decides for it too.
 */
export async function roleMustUseTwoFactor(ctx: Ctx, role: string): Promise<boolean> {
  if (!roleRequiresTwoFactor(role)) return false;
  return (await executeQuery(twoFactorPolicyQuery, {}, ctx, ports)).required;
}
