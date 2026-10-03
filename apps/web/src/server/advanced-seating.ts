import { effectiveModules } from '@yayatoh/billing';
import { createCtx } from '@yayatoh/kernel';

/**
 * Whether an org has advanced seating (M6.11a, P6-13 `advanced_seating`): best available and the
 * ADA engine. Public pages ask before showing them; the commands check it again.
 */
export async function hasAdvancedSeating(orgId: string): Promise<boolean> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'web.advanced-seating' } });
  return (await effectiveModules(ctx)).has('advanced_seating');
}
