'use server';

import {
  AudienceChoice,
  CampaignContent,
  campaignPreviewQuery,
  cancelCampaignCommand,
  createCampaignCommand,
  deleteCampaignCommand,
  pauseCampaignCommand,
  resumeCampaignCommand,
  saveCampaignCommand,
  scheduleCampaignCommand,
  sendNowCommand,
  setAudienceCommand,
  testSendCommand,
  unscheduleCampaignCommand,
} from '@yayatoh/campaigns';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { storeEmailPreviewCommand } from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { linkOrigin } from '@/lib/tracked-links.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** What a campaign form shows after submitting: a code (and reason), field errors, or success. */
export interface CampaignFormState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string | null;
  /** Field path (e.g. `name`, `subject`, `blocks.2.text`) → error key under `campaigns.errors`. */
  readonly errors?: Readonly<Record<string, string>>;
  readonly message?: string | null;
  readonly count?: number;
}

const OK: CampaignFormState = { ok: true, code: null };

/** Zod issues → `{ path: errorKey }` (the first issue per path). */
function fieldErrors(
  issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string; code?: string }>,
) {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const path = i.path.map(String).join('.');
    if (out[path]) continue;
    out[path] = [
      'footer_required',
      'unknown_merge_field',
      'invalid_path',
      'invalid_image',
      'duplicate_block',
    ].includes(i.message)
      ? i.message
      : i.code === 'too_big'
        ? 'too_long'
        : i.code === 'too_small'
          ? 'required'
          : 'invalid';
  }
  return out;
}

function failure(err: unknown): CampaignFormState {
  if (!isDomainError(err)) throw err;
  const reason = typeof err.details?.reason === 'string' ? err.details.reason : null;
  const field = typeof err.details?.field === 'string' ? err.details.field : null;
  const issues = Array.isArray(err.details?.issues)
    ? (err.details.issues as { path: string | string[]; message: string; code?: string }[])
    : [];
  const errors = issues.length
    ? fieldErrors(
        issues.map((i) => ({
          path: Array.isArray(i.path) ? i.path : String(i.path ?? '').split('.'),
          message: i.message,
          code: i.code,
        })),
      )
    : field
      ? { [field]: reason ?? err.code }
      : undefined;
  return { ok: false, code: err.code, reason, ...(errors ? { errors } : {}) };
}

const revalidate = (org: string, id?: string) => {
  revalidatePath(`/o/${org}/campaigns`);
  if (id) revalidatePath(`/o/${org}/campaigns/${id}`);
};

export async function createCampaignAction(
  org: string,
  _prev: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  const data = await loadConsole(org);
  let id: string;
  try {
    ({ id } = await executeCommand(
      createCampaignCommand,
      {
        name: String(form.get('name') ?? ''),
        channel: String(form.get('channel') ?? 'email') as 'email',
        locale: String(form.get('locale') ?? data.ctx.locale ?? 'en'),
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return failure(err);
  }
  revalidate(org);
  redirect({ href: `/o/${org}/campaigns/${id}?created=1`, locale: await getLocale() });
  return OK;
}

const parseContent = (json: string) => {
  try {
    return CampaignContent.safeParse(JSON.parse(json));
  } catch {
    return CampaignContent.safeParse(null);
  }
};

/** Save the draft (name, language, blocks). Field errors come back by path. */
export async function saveCampaignAction(
  org: string,
  campaignId: string,
  _prev: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  const data = await loadConsole(org);
  const content = parseContent(String(form.get('content') ?? ''));
  const nameRaw = String(form.get('name') ?? '').trim();
  const errors: Record<string, string> = {};
  if (!nameRaw) errors.name = 'required';
  if (!content.success) Object.assign(errors, fieldErrors(content.error.issues));
  if (Object.keys(errors).length) return { ok: false, code: 'validation_failed', errors };
  try {
    await executeCommand(
      saveCampaignCommand,
      {
        campaignId,
        name: nameRaw,
        locale: String(form.get('locale') ?? 'en'),
        content: content.data as CampaignContent,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidate(org, campaignId);
  return { ok: true, code: null, message: 'saved' };
}

export interface PreviewResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly src?: string;
  readonly subject?: string;
  readonly sms?: string | null;
}

/** The email as recipients will see it, for the editor's desktop/mobile frames. */
export async function previewCampaignAction(
  org: string,
  campaignId: string,
  contentJson: string | null,
): Promise<PreviewResult> {
  const data = await loadConsole(org);
  const content = contentJson ? parseContent(contentJson) : null;
  if (content && !content.success) return { ok: false, code: 'validation_failed' };
  try {
    const p = await executeQuery(
      campaignPreviewQuery,
      { campaignId, origin: linkOrigin(), ...(content?.success ? { content: content.data } : {}) },
      data.ctx,
      ports,
    );
    const stored = await executeCommand(storeEmailPreviewCommand, { html: p.html }, data.ctx, ports);
    return {
      ok: true,
      src: `/api/email-preview/${data.org.slug}/${stored.id}`,
      subject: p.subject,
      sms: p.sms,
    };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { ok: false, code: err.code };
  }
}

export async function setAudienceAction(
  org: string,
  campaignId: string,
  _prev: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  const data = await loadConsole(org);
  const kind = String(form.get('kind') ?? '');
  const raw =
    kind === 'segment'
      ? { kind, segmentId: String(form.get('segmentId') ?? '') }
      : {
          kind: 'template',
          templateKey: String(form.get('templateKey') ?? ''),
          eventId: String(form.get('eventId') ?? ''),
          ticketTypeIds: form.getAll('ticketTypeId').map(String),
        };
  const audience = AudienceChoice.safeParse(raw);
  if (!audience.success) {
    const errors: Record<string, string> = {};
    for (const i of audience.error.issues) errors[String(i.path[0] ?? 'kind')] = 'required';
    return { ok: false, code: 'validation_failed', errors };
  }
  try {
    await executeCommand(setAudienceCommand, { campaignId, audience: audience.data }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidate(org, campaignId);
  return { ok: true, code: null, message: 'audienceSaved' };
}

export async function testSendAction(
  org: string,
  campaignId: string,
  _prev: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  const data = await loadConsole(org);
  const addresses = String(form.get('addresses') ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (addresses.length === 0)
    return { ok: false, code: 'validation_failed', errors: { addresses: 'required' } };
  if (addresses.length > 5)
    return { ok: false, code: 'validation_failed', errors: { addresses: 'too_many' } };
  try {
    const r = await executeCommand(testSendCommand, { campaignId, addresses }, data.ctx, ports);
    return { ok: true, code: null, message: 'testSent', count: r.queued };
  } catch (err) {
    const f = failure(err);
    return f.code === 'validation_failed' ? { ...f, errors: { addresses: 'invalid_email' } } : f;
  }
}

export async function scheduleCampaignAction(
  org: string,
  campaignId: string,
  _prev: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  const data = await loadConsole(org);
  const at = String(form.get('at') ?? '').slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at))
    return { ok: false, code: 'validation_failed', errors: { at: 'required' } };
  try {
    await executeCommand(scheduleCampaignCommand, { campaignId, at }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidate(org, campaignId);
  return { ok: true, code: null, message: 'scheduled' };
}

export async function sendNowAction(
  org: string,
  campaignId: string,
  _prev: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  const data = await loadConsole(org);
  const key = String(form.get('key') ?? '');
  try {
    await executeCommand(
      sendNowCommand,
      { campaignId },
      { ...data.ctx, idempotencyKey: `campaign-send:${key}` },
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidate(org, campaignId);
  return { ok: true, code: null, message: 'sending' };
}

const LIFECYCLE = {
  unschedule: unscheduleCampaignCommand,
  pause: pauseCampaignCommand,
  resume: resumeCampaignCommand,
  cancel: cancelCampaignCommand,
} as const;

export async function lifecycleAction(
  org: string,
  campaignId: string,
  _prev: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  const data = await loadConsole(org);
  const op = String(form.get('op') ?? '') as keyof typeof LIFECYCLE;
  const command = LIFECYCLE[op];
  if (!command) return { ok: false, code: 'validation_failed' };
  try {
    await executeCommand(command, { campaignId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidate(org, campaignId);
  return { ok: true, code: null, message: op };
}

export async function deleteCampaignAction(org: string, campaignId: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(deleteCampaignCommand, { campaignId }, data.ctx, ports);
  revalidate(org);
  redirect({ href: `/o/${org}/campaigns`, locale: await getLocale() });
}
