'use server';

import { parseLinksText, SectionTextError } from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import {
  openExhibitorLinkCommand,
  PORTAL_SIGN_IN_LINK_MS,
  parsePortalLinkToken,
  portalInviteStaffCommand,
  portalRevokeStaffCommand,
  portalSaveProfileCommand,
  requestExhibitorLinkCommand,
} from '@yayatoh/program';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { scopeTag } from '@/lib/cache-keys.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import {
  endThisPortalSession,
  linkHashOf,
  newPortalLink,
  newPortalSession,
  portalCtx,
  portalLinkUrl,
  requirePortalPrincipal,
  sendPortalEmail,
  startPortalSession,
  verifySite,
} from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * Exhibitor portal actions (M5.4a). Every write goes through a program command that re-checks the
 * portal principal in its transaction; the org comes from the signed link or session cookie.
 */
const done = (locale: string) => revalidatePath(`/${locale}/exhibitor`);

/** Open an invitation or sign-in link: spend it, start this browser's session, go to the portal. */
export async function openLinkAction(
  locale: string,
  token: string,
  _prev: ProgramFormState,
  _form: FormData,
): Promise<ProgramFormState> {
  const link = parsePortalLinkToken(token);
  if (!link) return { ok: false, code: 'invalid_state', reason: 'link_invalid' };
  const session = newPortalSession(link.orgId);
  let eventId: string;
  try {
    const p = await executeCommand(
      openExhibitorLinkCommand,
      { memberId: link.memberId, linkHash: linkHashOf(link.secret), sessionHash: session.hash },
      portalCtx(link, locale),
      ports,
    );
    eventId = p.eventId;
  } catch (err) {
    return failure(err);
  }
  await startPortalSession(session.cookie, link.orgId, eventId);
  redirect(`/${locale}/exhibitor`);
}

/**
 * "Email me a sign-in link": rate limited per device, IP and address; the answer is the same
 * whether or not the address has access (no enumeration).
 */
export async function requestLinkAction(
  locale: string,
  site: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const target = verifySite(site);
  if (!target) return { ok: false, code: 'invalid_state', reason: 'link_invalid' };
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return { ok: false, code: 'validation_failed', fields: ['email'] };
  const decision = await limitAction('guestCode', { identity: email, scope: 'exhibitor_portal' });
  if (!decision.allowed) return { ok: false, code: 'rate_limited', reason: 'rate_limited' };
  const link = newPortalLink();
  try {
    const r = await executeCommand(
      requestExhibitorLinkCommand,
      { eventId: target.eventId, email, linkHash: link.hash },
      portalCtx(target, locale),
      ports,
    );
    if (r.memberId && r.eventName)
      await sendPortalEmail({
        kind: 'portal.exhibitor-sign-in',
        to: email,
        locale,
        orgId: target.orgId,
        params: {
          url: await portalLinkUrl(target.orgId, r.memberId, link.secret, locale),
          eventName: r.eventName,
          minutes: Math.round(PORTAL_SIGN_IN_LINK_MS / 60_000),
        },
      });
  } catch (err) {
    return failure(err);
  }
  return success();
}

export async function signOutAction(locale: string): Promise<void> {
  await endThisPortalSession();
  redirect(`/${locale}/exhibitor/signed-out`);
}

export async function saveProfileAction(
  locale: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const principal = await requirePortalPrincipal(locale);
  try {
    await executeCommand(
      portalSaveProfileCommand,
      {
        principal,
        name: String(form.get('name') ?? ''),
        description: String(form.get('description') ?? ''),
        websiteUrl: textOrNull(form, 'websiteUrl'),
        links: parseLinksText(String(form.get('links') ?? '')),
        categories: String(form.get('categories') ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      },
      portalCtx(principal, locale),
      ports,
    );
    done(locale);
    // The public exhibitor map (cached per org) shows an applied edit.
    updateTag(scopeTag({ org: principal.orgId }));
    // The page says whether the edit is live or waits for the organizer (it knows the setting).
    return success();
  } catch (err) {
    if (err instanceof SectionTextError)
      return { ok: false, code: 'validation_failed', fields: ['links'], reason: err.reason, line: err.line };
    return failure(err);
  }
}

export async function inviteStaffAction(
  locale: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const principal = await requirePortalPrincipal(locale);
  const link = newPortalLink();
  try {
    const r = await executeCommand(
      portalInviteStaffCommand,
      { principal, email: String(form.get('email') ?? ''), linkHash: link.hash },
      portalCtx(principal, locale),
      ports,
    );
    await sendPortalEmail({
      kind: 'portal.exhibitor-invite',
      to: r.member.email,
      locale,
      orgId: principal.orgId,
      params: {
        url: await portalLinkUrl(principal.orgId, r.member.id, link.secret, locale),
        eventName: r.eventName,
        exhibitorName: r.exhibitorName,
      },
    });
  } catch (err) {
    return failure(err);
  }
  done(locale);
  return success();
}

export async function revokeStaffAction(locale: string, memberId: string): Promise<void> {
  const principal = await requirePortalPrincipal(locale);
  await executeCommand(
    portalRevokeStaffCommand,
    { principal, memberId },
    portalCtx(principal, locale),
    ports,
  );
  done(locale);
}
