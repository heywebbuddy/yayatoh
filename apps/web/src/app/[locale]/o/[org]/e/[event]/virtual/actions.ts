'use server';

import { setEventDetailsCommand } from '@yayatoh/events';
import { createZoomWebinar } from '@yayatoh/integrations';
import { executeCommand } from '@yayatoh/kernel';
import {
  ACCESS_MODES,
  type AccessMode,
  createStreamCommand,
  DELIVERY_MODES,
  type DeliveryMode,
  type Ingest,
  revealStreamKeyCommand,
  setActiveIngestCommand,
  setStreamEnabledCommand,
  setTicketAccessCommand,
  switchStreamProviderCommand,
  VIDEO_PROVIDERS,
  type VideoProviderName,
} from '@yayatoh/virtual';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';

/**
 * Stream setup (M6.9a): the event's delivery mode (its attendance mode), access per ticket type,
 * and one live stream per session. The commands check `events:write` and the `virtual` module.
 */
const path = (org: string, event: string) => `/o/${org}/e/${event}/virtual`;

const isDelivery = (v: string): v is DeliveryMode => (DELIVERY_MODES as readonly string[]).includes(v);
const isAccess = (v: string): v is AccessMode => (ACCESS_MODES as readonly string[]).includes(v);
const isProvider = (v: string): v is VideoProviderName => (VIDEO_PROVIDERS as readonly string[]).includes(v);

export async function setDeliveryAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'virtual');
  const mode = String(form.get('delivery') ?? '');
  if (!isDelivery(mode)) return { ok: false, code: 'validation_failed', fields: ['delivery'] };
  try {
    await executeCommand(setEventDetailsCommand, { eventId: ev.id, attendanceMode: mode }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}

export async function setAccessAction(
  org: string,
  event: string,
  ticketTypeId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'virtual');
  const access = String(form.get('access') ?? '');
  if (!isAccess(access)) return { ok: false, code: 'validation_failed', fields: ['access'] };
  try {
    await executeCommand(setTicketAccessCommand, { eventId: ev.id, ticketTypeId, access }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}

export async function createStreamAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: FormState,
  form?: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'virtual');
  // M6.10a: the provider chosen for the session (the default without a choice).
  const chosen = String(form?.get('provider') ?? '');
  if (chosen && !isProvider(chosen)) return { ok: false, code: 'validation_failed', fields: ['provider'] };
  try {
    await executeCommand(
      createStreamCommand,
      { eventId: ev.id, sessionId, ...(chosen && isProvider(chosen) ? { provider: chosen } : {}) },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}

export async function setStreamEnabledAction(
  org: string,
  event: string,
  sessionId: string,
  enabled: boolean,
  _prev: FormState,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'virtual');
  try {
    await executeCommand(setStreamEnabledCommand, { eventId: ev.id, sessionId, enabled }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}

/** What revealing a stream key returns: the encoder's server and key (shown, never stored). */
export interface StreamKeyState extends FormState {
  readonly ingestUrl?: string;
  readonly streamKey?: string;
  /** M6.10a: which ingest `ingestUrl` is. */
  readonly activeIngest?: Ingest;
}

export async function revealStreamKeyAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: StreamKeyState,
): Promise<StreamKeyState> {
  const { data, event: ev } = await loadEvent(org, event, 'virtual');
  try {
    const r = await executeCommand(revealStreamKeyCommand, { eventId: ev.id, sessionId }, data.ctx, ports);
    return { ...success(), ingestUrl: r.ingestUrl, streamKey: r.streamKey, activeIngest: r.activeIngest };
  } catch (err) {
    return failure(err);
  }
}

/** M6.10a: what switching a provider returns (whether it moved). */
export interface SwitchState extends FormState {
  readonly switched?: boolean;
}

/** M6.10a: move a session's stream to another provider (grants and minutes stay). */
export async function switchProviderAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: SwitchState,
  form: FormData,
): Promise<SwitchState> {
  const { data, event: ev } = await loadEvent(org, event, 'virtual');
  const provider = String(form.get('provider') ?? '');
  if (!isProvider(provider)) return { ok: false, code: 'validation_failed', fields: ['provider'] };
  let switched = false;
  try {
    const r = await executeCommand(
      switchStreamProviderCommand,
      { eventId: ev.id, sessionId, provider },
      data.ctx,
      ports,
    );
    switched = r.switched;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return { ...success(), switched };
}

/** M6.10a RTMP overflow: the encoder's ingest, primary or backup. */
export async function setIngestAction(
  org: string,
  event: string,
  sessionId: string,
  ingest: Ingest,
  _prev: FormState,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'virtual');
  try {
    await executeCommand(setActiveIngestCommand, { eventId: ev.id, sessionId, ingest }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}

/** M6.10a: create the session's Zoom webinar through the org's Zoom connection. */
export async function createZoomWebinarAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: FormState,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'virtual');
  try {
    await createZoomWebinar(data.ctx, ports, integrationAuth(), { eventId: ev.id, sessionId });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}
