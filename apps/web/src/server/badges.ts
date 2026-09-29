import 'server-only';
import { badgesSetupQuery, listBatchesQuery, runBadgeBatch } from '@yayatoh/badges';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { notFound } from 'next/navigation';
import { loadEvent } from './console.ts';
import { getPdfRenderer } from './pdf.ts';
import { ports } from './ports.ts';

/**
 * The Badges pages (M5.5a): only for profiles whose navigation lists Badges (the conference
 * profile) and orgs with the `badges` module. Other profiles, foreign and unknown events are a 404.
 */
export async function loadBadgesPage(org: string, event: string) {
  const { data, event: ev } = await loadEvent(org, event);
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!navIncludes(profile, data.modules, 'badges')) notFound();
  const setup = await executeQuery(badgesSetupQuery, { eventId: ev.id }, data.ctx, ports);
  return {
    data,
    ev,
    setup,
    canWrite: roleCan(data.role, 'events:write'),
    canExport: roleCan(data.role, 'attendees:export'),
    canPrintOne: roleCan(data.role, 'attendees:write'),
  };
}

export const loadBatches = async (ctx: Parameters<typeof executeQuery>[2], eventId: string) =>
  executeQuery(listBatchesQuery, { eventId, limit: 10 }, ctx, ports);

/**
 * Work a just-started batch for a few seconds in the request (small batches finish before the
 * page reloads); the worker's `badges.batch` job picks up the rest. No renderer, no inline run.
 */
export async function runBatchInline(orgId: string, batchId: string, budgetMs = 8_000): Promise<void> {
  const renderer = getPdfRenderer();
  if (!renderer) return;
  await runBadgeBatch({ ports, renderer }, orgId, batchId, { budgetMs, failOnError: true });
}
