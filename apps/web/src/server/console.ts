import 'server-only';
import { effectiveModules } from '@yayatoh/billing';
import { getEventBySlugQuery } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { isProfileKey, type ProfileKey } from '@yayatoh/platform';
import {
  getOrganizationQuery,
  memberRole,
  myOrganizations,
  resolveOrgSlug,
  roleRequiresTwoFactor,
} from '@yayatoh/tenancy';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from './ports.ts';
import { getSession } from './session.ts';

/**
 * Everything the console needs for one org, loaded once per request. The org comes from the
 * route param; the user must be a member (RLS + membership check). A non-member gets a 404 so
 * the org's existence is not revealed. Owners, admins and finance (in any org) must turn on
 * two-step verification first: every console sends them to set it up (M1.2c). Server Actions
 * load the console too, so the same rule covers every write.
 */
export const loadConsole = cache(async (orgSlug: string) => {
  const locale = await getLocale();
  const session = await getSession();
  if (!session) return redirect({ href: '/sign-in', locale });
  const orgs = await myOrganizations(session.userId);
  if (!session.twoFactorEnabled && orgs.some((o) => roleRequiresTwoFactor(o.role)))
    return redirect({ href: '/account/security?required=1', locale });
  const resolved = await resolveOrgSlug(orgSlug);
  if (!resolved || resolved.status === 'terminated') notFound();
  const ctx = createCtx({
    orgId: resolved.orgId,
    actor: { type: 'user', userId: session.userId },
    locale,
    stepUpAt: session.stepUpAt,
  });
  const role = await memberRole(ctx);
  if (!role) notFound();
  const [org, modules] = await Promise.all([
    executeQuery(getOrganizationQuery, {}, ctx, ports),
    effectiveModules(ctx),
  ]);
  const profile: ProfileKey = isProfileKey(org.defaultProfile) ? org.defaultProfile : 'other';
  return { session, ctx, org, role, modules, orgs, profile };
});

export type ConsoleData = Awaited<ReturnType<typeof loadConsole>>;

/** The event for the console route, under the org's RLS. Unknown or foreign slugs are a 404. */
export const loadEvent = cache(async (orgSlug: string, eventSlug: string) => {
  const data = await loadConsole(orgSlug);
  try {
    const event = await executeQuery(getEventBySlugQuery, { slug: eventSlug }, data.ctx, ports);
    return { data, event };
  } catch (err) {
    // A member whose role cannot read events (e.g. a scanner) gets the not-found page, which
    // says they may not have access, instead of an error page.
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) notFound();
    throw err;
  }
});
