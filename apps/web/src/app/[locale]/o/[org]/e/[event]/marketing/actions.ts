'use server';

import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { AnnouncementInput, previewAnnouncementQuery, sendAnnouncementCommand } from '@yayatoh/messaging';
import { storeEmailPreviewCommand } from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface ComposerValues {
  readonly subject: string;
  readonly body: string;
  readonly channels: readonly string[];
}

export type ComposerState =
  | {
      readonly step: 'edit';
      readonly values: ComposerValues;
      readonly errors: Readonly<Record<string, string>>;
      readonly code: string | null;
      readonly sentTo?: number;
    }
  | {
      readonly step: 'preview';
      readonly values: ComposerValues;
      /** `src`: the stored preview's same-origin URL (served with its own CSP, M1.10d). */
      readonly preview: {
        readonly recipients: number;
        readonly subject: string;
        readonly src: string;
        /** The text message and its segments, when SMS is chosen (M3.5a). */
        readonly sms: {
          readonly text: string;
          readonly characters: number;
          readonly segments: number;
          readonly encoding: string;
          readonly withPhone: number;
        } | null;
        /** Chosen channels whose monthly quota is used up. */
        readonly quotaReached: readonly string[];
      };
      readonly key: string;
    };

const EMPTY: ComposerValues = { subject: '', body: '', channels: ['email'] };

/**
 * The composer's single action: `preview` validates and renders; `send` sends what was
 * previewed (with the Idempotency-Key minted at preview, so a double submit sends once);
 * `edit` goes back to the form.
 */
export async function composerAction(
  org: string,
  event: string,
  _prev: ComposerState,
  form: FormData,
): Promise<ComposerState> {
  const { data, event: ev } = await loadEvent(org, event);
  const values: ComposerValues = {
    subject: String(form.get('subject') ?? ''),
    body: String(form.get('body') ?? ''),
    channels: form.getAll('channel').map(String),
  };
  const intent = String(form.get('intent') ?? 'preview');
  if (intent === 'edit') return { step: 'edit', values, errors: {}, code: null };
  const parsed = AnnouncementInput.safeParse({ eventId: ev.id, ...values });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const field = String(i.path[0] ?? '');
      if (field && !errors[field]) errors[field] = field === 'channels' ? 'channelRequired' : 'required';
    }
    return { step: 'edit', values, errors, code: 'validation_failed' };
  }
  try {
    if (intent === 'send') {
      const key = String(form.get('key') ?? '');
      const r = await executeCommand(
        sendAnnouncementCommand,
        parsed.data,
        { ...data.ctx, idempotencyKey: key },
        ports,
      );
      revalidatePath(`/o/${org}/e/${event}/marketing`);
      return { step: 'edit', values: EMPTY, errors: {}, code: null, sentTo: r.recipients };
    }
    const preview = await executeQuery(previewAnnouncementQuery, parsed.data, data.ctx, ports);
    if (preview.recipients === 0) return { step: 'edit', values, errors: {}, code: 'no_recipients' };
    const stored = await executeCommand(storeEmailPreviewCommand, { html: preview.html }, data.ctx, ports);
    return {
      step: 'preview',
      values,
      preview: {
        recipients: preview.recipients,
        subject: preview.subject,
        src: `/api/email-preview/${data.org.slug}/${stored.id}`,
        sms: preview.sms,
        quotaReached: preview.quotaReached,
      },
      key: crypto.randomUUID(),
    };
  } catch (err) {
    const reason = isDomainError(err) ? String(err.details?.reason ?? '') : '';
    return {
      step: 'edit',
      values,
      errors: {},
      code:
        reason === 'no_recipients' || reason === 'messaging_paused'
          ? reason
          : isDomainError(err)
            ? err.code
            : 'internal',
    };
  }
}
