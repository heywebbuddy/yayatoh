import 'server-only';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { cfpReviewerHomeQuery } from '@yayatoh/program';
import { cache } from 'react';
import { currentPortalPrincipal, portalRequestCtx } from './portal.ts';
import { ports } from './ports.ts';

/**
 * The signed-in call-for-papers reviewer's portal (M5.3b), or null when nobody (or no reviewer)
 * is signed in on this host. The query re-checks the account and lists only the submissions
 * assigned to this reviewer. Once per request.
 */
export const loadReviewerPortal = cache(async () => {
  const principal = await currentPortalPrincipal();
  if (principal?.role !== 'cfp_reviewer') return null;
  const ctx = await portalRequestCtx(principal);
  try {
    return { principal, ctx, data: await executeQuery(cfpReviewerHomeQuery, {}, ctx, ports) };
  } catch (err) {
    // The reviewer was removed (or the module switched off): nothing to show.
    if (isDomainError(err) && (err.code === 'forbidden' || err.code === 'module_not_enabled')) return null;
    throw err;
  }
});
