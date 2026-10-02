'use server';

import { parseLinksText, SectionTextError } from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import {
  portalInviteStaffCommand,
  portalRevokeStaffCommand,
  portalSaveProfileCommand,
} from '@yayatoh/program';
import { refresh, updateTag } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { scopeTag } from '@/lib/cache-keys.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { portalRequestCtx, requirePortalPrincipal } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';

/**
 * Exhibitor portal actions (M5.4a on M5.3a's portal sign-in). Every write is a `portal:exhibitor_*`
 * command that re-checks the signed-in account and its exhibitor in its transaction; the org comes
 * from the portal session cookie. Staff invitations are emailed by the portal invite mailer.
 */
async function asExhibitor() {
  const p = await requirePortalPrincipal();
  return { principal: p, ctx: await portalRequestCtx(p) };
}

export async function saveProfileAction(_prev: ProgramFormState, form: FormData): Promise<ProgramFormState> {
  try {
    const { principal, ctx } = await asExhibitor();
    await executeCommand(
      portalSaveProfileCommand,
      {
        name: String(form.get('name') ?? ''),
        description: String(form.get('description') ?? ''),
        websiteUrl: textOrNull(form, 'websiteUrl'),
        links: parseLinksText(String(form.get('links') ?? '')),
        categories: String(form.get('categories') ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      },
      ctx,
      ports,
    );
    // The public exhibitor map (cached per org) shows an applied edit.
    updateTag(scopeTag({ org: principal.orgId }));
  } catch (err) {
    if (err instanceof SectionTextError)
      return { ok: false, code: 'validation_failed', fields: ['links'], reason: err.reason, line: err.line };
    return failure(err);
  }
  refresh();
  // The page says whether the edit is live or waits for the organizer (it knows the setting).
  return success();
}

export async function inviteStaffAction(_prev: ProgramFormState, form: FormData): Promise<ProgramFormState> {
  try {
    const { ctx } = await asExhibitor();
    await executeCommand(portalInviteStaffCommand, { email: String(form.get('email') ?? '') }, ctx, ports);
  } catch (err) {
    return failure(err);
  }
  refresh();
  return success();
}

export async function revokeStaffAction(memberId: string): Promise<void> {
  const { ctx } = await asExhibitor();
  await executeCommand(portalRevokeStaffCommand, { memberId }, ctx, ports);
  refresh();
}
