'use server';

import {
  claimStaffPushCommand,
  deviceContext,
  requestDeviceSyncCommand,
  revokeDeviceCommand,
  type SupervisorViewDto,
  startKioskCommand,
  stopKioskCommand,
  switchDeviceCheckpointCommand,
} from '@yayatoh/checkin';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { memberRole, roleRequiresTwoFactor } from '@yayatoh/tenancy';
import { getLocale } from 'next-intl/server';
import type { z } from 'zod';
import { ports } from './ports.ts';
import { supervisorView } from './scan-staff.ts';
import { getSession } from './session.ts';

/**
 * Supervisor mode in the Scan PWA (M3.4a). Two credentials meet here: the device token picks the
 * org (never a header or a form field), and the signed-in member in this browser is who acts. The
 * member must belong to that org; each command then checks their permission (org role, or an event
 * role for this event), step-up for revoke, and audits.
 */
async function supervisorCtx(token: string): Promise<Ctx | 'signed_out' | 'forbidden'> {
  const dc = await deviceContext(token);
  if (!dc?.ctx.orgId) return 'forbidden';
  const session = await getSession();
  if (!session) return 'signed_out';
  // Staff acting as a member (impersonation) never supervise a door from a device.
  if (session.impersonation) return 'forbidden';
  const ctx = createCtx({
    orgId: dc.ctx.orgId,
    actor: { type: 'user', userId: session.userId },
    locale: await getLocale(),
    stepUpAt: session.stepUpAt,
  });
  const role = await memberRole(ctx);
  if (!role) return 'forbidden';
  // Roles that must use two-step verification only act once it is on (as in the console).
  if (!session.twoFactorEnabled && roleRequiresTwoFactor(role)) return 'forbidden';
  return ctx;
}

export type SupervisorLoad =
  | { readonly state: 'signed_out' | 'forbidden' | 'offline' }
  | {
      readonly state: 'ok';
      readonly view: z.infer<typeof SupervisorViewDto>;
      readonly canSupervise: boolean;
      readonly canKiosk: boolean;
    };

export async function loadSupervisorAction(token: string, eventId: string): Promise<SupervisorLoad> {
  const ctx = await supervisorCtx(token);
  if (typeof ctx === 'string') return { state: ctx };
  try {
    const view = await executeQuery(supervisorView, { eventId }, ctx, ports);
    const canSupervise = await ports.authorizer.can(ctx, 'checkin:supervise', { eventId });
    return { state: 'ok', view, canSupervise, canKiosk: true };
  } catch (err) {
    if (isDomainError(err) && (err.code === 'forbidden' || err.code === 'not_found'))
      return { state: 'forbidden' };
    throw err;
  }
}

export type SupervisorAction =
  | { readonly action: 'sync' | 'revoke' | 'kiosk_stop'; readonly eventId: string; readonly deviceId: string }
  | {
      readonly action: 'switch';
      readonly eventId: string;
      readonly deviceId: string;
      readonly checkpointId: string | null;
    }
  | {
      readonly action: 'kiosk_start';
      readonly eventId: string;
      readonly deviceId: string;
      readonly checkpointId: string | null;
      readonly pin: string;
    }
  | { readonly action: 'alerts'; readonly eventId: string; readonly deviceId: string; readonly on: boolean };

/** Run one supervisor action; `{ code }` names why it didn't (step_up_required opens the dialog). */
export async function supervisorAction(
  token: string,
  a: SupervisorAction,
): Promise<{ readonly code: string | null; readonly field?: string | null }> {
  const ctx = await supervisorCtx(token);
  if (ctx === 'signed_out') return { code: 'unauthenticated' };
  if (ctx === 'forbidden') return { code: 'forbidden' };
  const target = { eventId: a.eventId, deviceId: a.deviceId };
  try {
    switch (a.action) {
      case 'sync':
        await executeCommand(requestDeviceSyncCommand, target, ctx, ports);
        break;
      case 'revoke':
        await executeCommand(revokeDeviceCommand, target, ctx, ports);
        break;
      case 'switch':
        await executeCommand(
          switchDeviceCheckpointCommand,
          { ...target, checkpointId: a.checkpointId },
          ctx,
          ports,
        );
        break;
      case 'kiosk_start':
        await executeCommand(
          startKioskCommand,
          { ...target, checkpointId: a.checkpointId, pin: a.pin },
          ctx,
          ports,
        );
        break;
      case 'kiosk_stop':
        await executeCommand(stopKioskCommand, target, ctx, ports);
        break;
      case 'alerts':
        await executeCommand(claimStaffPushCommand, { ...target, supervisor: a.on }, ctx, ports);
        break;
    }
    return { code: null };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const details = err.details as { field?: string } | undefined;
    return { code: err.code, field: details?.field ?? null };
  }
}
