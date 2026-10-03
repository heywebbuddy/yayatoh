import 'server-only';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { manageTokenOrg } from '@yayatoh/orders';
import { myScheduleQuery } from '@yayatoh/registration';
import { ports } from './ports.ts';

/**
 * M5.2b: whether an order's page links to "My schedule": a registrant with at least one session
 * their items give. Null for orders without registration (or with the module off).
 */
export async function scheduleSummary(token: string): Promise<{ sessions: number } | null> {
  const orgId = await manageTokenOrg(token);
  if (!orgId) return null;
  try {
    const s = await executeQuery(myScheduleQuery, { token, registrantId: null }, createCtx({ orgId }), ports);
    return s.registrantId && s.sessions.length > 0 ? { sessions: s.sessions.length } : null;
  } catch (err) {
    if (isDomainError(err)) return null;
    throw err;
  }
}
