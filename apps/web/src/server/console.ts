import 'server-only';
import { effectiveModules } from '@yayatoh/billing';
import { getEventBySlugQuery } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { listMediaQuery } from '@yayatoh/media';
import { isProfileKey, type ProfileKey } from '@yayatoh/platform';
import { getOrganizationQuery, memberRole, myOrganizations, resolveOrgSlug } from '@yayatoh/tenancy';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from './ports.ts';
import { getSession } from './session.ts';

/**
 * Everything the console needs for one org, loaded once per request. The org comes from the
 * route param; the user must be a member (RLS + membership check). A non-member gets a 404 so
 * the org's existence is not revealed.
 */
export const loadConsole = cache(async (orgSlug: string) => {
  const locale = await getLocale();
  const session = await getSession();
  if (!session) return redirect({ href: '/sign-in', locale });
  const resolved = await resolveOrgSlug(orgSlug);
  if (!resolved || resolved.status === 'terminated') notFound();
  const ctx = createCtx({ orgId: resolved.orgId, actor: { type: 'user', userId: session.userId }, locale });
  const role = await memberRole(ctx);
  if (!role) notFound();
  const [org, modules, orgs, logos] = await Promise.all([
    executeQuery(getOrganizationQuery, {}, ctx, ports),
    effectiveModules(ctx),
    myOrganizations(session.userId),
    // The brand kit logo (M1.4e), shown in the console header.
    executeQuery(listMediaQuery, { ownerType: 'org', ownerId: resolved.orgId, slot: 'logo' }, ctx, ports),
  ]);
  const profile: ProfileKey = isProfileKey(org.defaultProfile) ? org.defaultProfile : 'other';
  return { session, ctx, org, role, modules, orgs, profile, logo: logos[0] ?? null };
});

export type ConsoleData = Awaited<ReturnType<typeof loadConsole>>;

/** The event for the console route, under the org's RLS. Unknown or foreign slugs are a 404. */
export const loadEvent = cache(async (orgSlug: string, eventSlug: string) => {
  const data = await loadConsole(orgSlug);
  try {
    const event = await executeQuery(getEventBySlugQuery, { slug: eventSlug }, data.ctx, ports);
    return { data, event };
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
});
