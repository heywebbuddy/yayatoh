import { assignCommand, queueQuery, staffRequestCommand, updateCommand } from '@yayatoh/assistance';
import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, executeCommand, executeQuery } from '@yayatoh/kernel';

/**
 * Help requests on the door apps (M3.3b, device token only), shared by the Scan PWA
 * (`/api/scan/assistance`) and the Staff app (`/v1/staff/…`): the event's open queue, a staff
 * request (backup, supervisor, medical, security, device) tied to this device and the entrance it
 * scans at, and working one request (take, start, resolve, cancel).
 */
export const STAFF_ASSISTANCE_ACTIONS = ['take', 'start', 'resolve', 'cancel'] as const;
export type StaffAssistanceAction = (typeof STAFF_ASSISTANCE_ACTIONS)[number];

export function openAssistanceQueue(ctx: Ctx, eventId: string, ports: CommandPorts<TenantTx>) {
  return executeQuery(queueQuery, { eventId, status: 'open', limit: 50 }, ctx, ports);
}

export function raiseStaffRequest(
  ctx: Ctx,
  body: { eventId?: unknown; reason?: unknown; note?: unknown; checkpointId?: unknown },
  ports: CommandPorts<TenantTx>,
) {
  return executeCommand(
    staffRequestCommand,
    {
      eventId: body.eventId as string,
      reason: body.reason as never,
      note: typeof body.note === 'string' ? body.note : '',
      checkpointId: typeof body.checkpointId === 'string' && body.checkpointId ? body.checkpointId : null,
    },
    ctx,
    ports,
  );
}

/** `take` gives the request to this device; `start`, `resolve` and `cancel` move it on. */
export async function workStaffRequest(
  ctx: Ctx,
  ref: { eventId: unknown; requestId: string; action: unknown },
  ports: CommandPorts<TenantTx>,
) {
  const base = { eventId: ref.eventId as string, requestId: ref.requestId };
  const r =
    ref.action === 'take'
      ? await executeCommand(assignCommand, { ...base, assignee: 'me' as const }, ctx, ports)
      : await executeCommand(updateCommand, { ...base, action: ref.action as never }, ctx, ports);
  return { state: r.state };
}
