'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  createEndpointCommand,
  deleteEndpointCommand,
  recoverFailedCommand,
  resendMessageCommand,
  revealEndpointSecretCommand,
  rotateEndpointSecretCommand,
  sendTestCommand,
  updateEndpointCommand,
} from '@yayatoh/webhooks';
import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type EndpointField = 'url' | 'description' | 'eventTypes';

export type EndpointFormState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved' }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly fields: readonly EndpointField[];
      /** Why a URL was refused (`scheme`, `address`, …), or `endpoint_limit`, `webhooks_unavailable`. */
      readonly reason?: string;
    };

const FIELDS: readonly EndpointField[] = ['url', 'description', 'eventTypes'];

function failure(err: unknown): EndpointFormState {
  if (!isDomainError(err)) return { kind: 'error', code: 'internal', fields: [] };
  const issues = (err.details?.issues as { path: string | (string | number)[] }[] | undefined) ?? [];
  const fields = [
    ...new Set(issues.map((i) => String(Array.isArray(i.path) ? i.path[0] : i.path.split('.')[0]))),
  ].filter((f): f is EndpointField => (FIELDS as readonly string[]).includes(f));
  const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined;
  return { kind: 'error', code: err.code, fields, ...(reason ? { reason } : {}) };
}

/** What the form says to receive: every type, or the ticked ones (at least one). */
function eventTypesOf(form: FormData): string[] | null {
  if (form.get('receive') !== 'selected') return [];
  const types = form.getAll('eventType').map(String);
  return types.length > 0 ? types : null;
}

export async function createEndpointAction(
  org: string,
  _prev: EndpointFormState,
  form: FormData,
): Promise<EndpointFormState> {
  const data = await loadConsole(org);
  const eventTypes = eventTypesOf(form);
  if (!eventTypes)
    return { kind: 'error', code: 'validation_failed', fields: ['eventTypes'], reason: 'no_types' };
  let id: string;
  try {
    const r = await executeCommand(
      createEndpointCommand,
      {
        url: String(form.get('url') ?? '').trim(),
        description: String(form.get('description') ?? '').trim(),
        eventTypes,
      },
      data.ctx,
      ports,
    );
    id = r.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/webhooks`);
  // The new endpoint's page: its secret, a test send and its deliveries.
  return redirect({ href: `/o/${org}/webhooks/${id}?created=1`, locale: data.ctx.locale ?? 'en' });
}

export async function updateEndpointAction(
  org: string,
  endpointId: string,
  _prev: EndpointFormState,
  form: FormData,
): Promise<EndpointFormState> {
  const data = await loadConsole(org);
  const eventTypes = eventTypesOf(form);
  if (!eventTypes)
    return { kind: 'error', code: 'validation_failed', fields: ['eventTypes'], reason: 'no_types' };
  try {
    await executeCommand(
      updateEndpointCommand,
      {
        endpointId,
        url: String(form.get('url') ?? '').trim(),
        description: String(form.get('description') ?? '').trim(),
        eventTypes,
        enabled: form.get('enabled') === 'on',
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/webhooks`);
  revalidatePath(`/o/${org}/webhooks/${endpointId}`);
  return { kind: 'saved' };
}

export type SecretState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'shown'; readonly secret: string }
  | { readonly kind: 'rotated' }
  | { readonly kind: 'error'; readonly code: string };

/** Show the signing secret (audited). */
export async function revealSecretAction(org: string, endpointId: string): Promise<SecretState> {
  const data = await loadConsole(org);
  try {
    const r = await executeCommand(revealEndpointSecretCommand, { endpointId }, data.ctx, ports);
    return { kind: 'shown', secret: r.secret };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
}

/** A new signing secret (step-up); the old one keeps signing alongside it for 24 hours. */
export async function rotateSecretAction(
  org: string,
  endpointId: string,
  _prev: SecretState,
  _form: FormData,
): Promise<SecretState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(rotateEndpointSecretCommand, { endpointId }, data.ctx, ports);
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/webhooks/${endpointId}`);
  return { kind: 'rotated' };
}

export type SendTestState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sent'; readonly eventType: string; readonly messageId: string }
  | { readonly kind: 'error'; readonly code: string; readonly reason?: string };

export async function sendTestAction(
  org: string,
  endpointId: string,
  _prev: SendTestState,
  form: FormData,
): Promise<SendTestState> {
  const data = await loadConsole(org);
  const eventType = String(form.get('eventType') ?? 'webhook.test');
  try {
    const r = await executeCommand(sendTestCommand, { endpointId, eventType }, data.ctx, ports);
    revalidatePath(`/o/${org}/webhooks/${endpointId}`);
    return { kind: 'sent', eventType, messageId: r.messageId };
  } catch (err) {
    if (!isDomainError(err)) return { kind: 'error', code: 'internal' };
    const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined;
    return { kind: 'error', code: err.code, ...(reason ? { reason } : {}) };
  }
}

export type ReplayState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'resent' }
  | { readonly kind: 'recovering' }
  | { readonly kind: 'error'; readonly code: string };

/** Send one message to this endpoint again (replay). */
export async function resendAction(
  org: string,
  endpointId: string,
  messageId: string,
  _prev: ReplayState,
  _form: FormData,
): Promise<ReplayState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(resendMessageCommand, { endpointId, messageId }, data.ctx, ports);
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/webhooks/${endpointId}`);
  return { kind: 'resent' };
}

const RECOVER_WINDOWS: Readonly<Record<string, number>> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};

/** Resend every message that failed since the chosen time. */
export async function recoverAction(
  org: string,
  endpointId: string,
  _prev: ReplayState,
  form: FormData,
): Promise<ReplayState> {
  const data = await loadConsole(org);
  const window = RECOVER_WINDOWS[String(form.get('window') ?? '24h')] ?? RECOVER_WINDOWS['24h'] ?? 86_400_000;
  try {
    await executeCommand(
      recoverFailedCommand,
      { endpointId, since: new Date(Date.now() - window) },
      data.ctx,
      ports,
    );
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/webhooks/${endpointId}`);
  return { kind: 'recovering' };
}

/** Delete the endpoint; back to the list. */
export async function deleteEndpointAction(
  org: string,
  endpointId: string,
  _form?: FormData,
): Promise<{ code: string } | undefined> {
  const data = await loadConsole(org);
  try {
    await executeCommand(deleteEndpointCommand, { endpointId }, data.ctx, ports);
  } catch (err) {
    return { code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/webhooks`);
  return redirect({ href: `/o/${org}/webhooks?deleted=1`, locale: data.ctx.locale ?? 'en' });
}
