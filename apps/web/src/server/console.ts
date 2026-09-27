import 'server-only';
import { effectiveModules } from '@yayatoh/billing';
import { createCtx, executeQuery } from '@yayatoh/kernel';
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
  if (!session) return redirect({ href: '/dev/login', locale });
  const resolved = await resolveOrgSlug(orgSlug);
  if (!resolved || resolved.status === 'terminated') notFound();
  const ctx = createCtx({ orgId: resolved.orgId, actor: { type: 'user', userId: session.userId }, locale });
  const role = await memberRole(ctx);
  if (!role) notFound();
  const [org, modules, orgs] = await Promise.all([
    executeQuery(getOrganizationQuery, {}, ctx, ports),
    effectiveModules(ctx),
    myOrganizations(session.userId),
  ]);
  const profile: ProfileKey = isProfileKey(org.defaultProfile) ? org.defaultProfile : 'other';
  return { session, ctx, org, role, modules, orgs, profile };
});

export type ConsoleData = Awaited<ReturnType<typeof loadConsole>>;
