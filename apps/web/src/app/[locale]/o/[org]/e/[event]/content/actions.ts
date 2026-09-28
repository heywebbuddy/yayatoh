'use server';

import { DRAFT_KINDS, type DraftKind, draftEventCopy, MAX_NOTES_LENGTH } from '@yayatoh/ai';
import {
  addSectionCommand,
  createAnnouncementCommand,
  deleteAnnouncementCommand,
  deleteSectionCommand,
  parseFaqText,
  parseLinksText,
  parseScheduleText,
  reorderSectionsCommand,
  SECTION_KINDS,
  type SectionKind,
  SectionTextError,
  updateAnnouncementCommand,
  updateEventCommand,
  updateSectionCommand,
} from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import type { FormState } from '@/lib/form-state.ts';
import { aiDrafter } from '@/server/ai.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

/** Build a section's content from its form (list-shaped kinds are edited as plain text). */
function contentFrom(kind: SectionKind, form: FormData): unknown {
  const text = (k: string) => String(form.get(k) ?? '');
  switch (kind) {
    case 'text':
      return { markdown: text('markdown') };
    case 'faq':
      return { items: parseFaqText(text('faq')) };
    case 'schedule':
      return { items: parseScheduleText(text('schedule')) };
    case 'links':
      return { items: parseLinksText(text('links')) };
    case 'location':
      return {
        address: text('address').trim(),
        directions: text('directions'),
        mapUrl: textOrNull(form, 'mapUrl'),
      };
  }
}

function textError(err: unknown): FormState | null {
  return err instanceof SectionTextError
    ? { ok: false, code: 'validation_failed', fields: ['content'], reason: err.reason, line: err.line }
    : null;
}

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/content`);

export async function addSectionAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const kind = String(form.get('kind') ?? '') as SectionKind;
  if (!SECTION_KINDS.includes(kind)) return { ok: false, code: 'validation_failed', fields: ['kind'] };
  try {
    await executeCommand(
      addSectionCommand,
      { eventId: ev.id, kind, title: String(form.get('title') ?? ''), content: contentFrom(kind, form) },
      data.ctx,
      ports,
    );
  } catch (err) {
    return textError(err) ?? failure(err);
  }
  done(org, event);
  return success();
}

export async function updateSectionAction(
  org: string,
  event: string,
  sectionId: string,
  kind: SectionKind,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      updateSectionCommand,
      {
        eventId: ev.id,
        sectionId,
        title: String(form.get('title') ?? ''),
        content: contentFrom(kind, form),
        visible: form.get('visible') === '1',
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return textError(err) ?? failure(err);
  }
  done(org, event);
  return success();
}

export async function deleteSectionAction(org: string, event: string, sectionId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(deleteSectionCommand, { eventId: ev.id, sectionId }, data.ctx, ports);
  done(org, event);
}

/** Keyboard/button path: one step up or down. */
export async function moveSectionAction(
  org: string,
  event: string,
  sectionId: string,
  move: 'up' | 'down',
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(reorderSectionsCommand, { eventId: ev.id, sectionId, move }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

/** Drag-and-drop path: the whole new order. */
export async function reorderSectionsAction(org: string, event: string, order: string[]): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(reorderSectionsCommand, { eventId: ev.id, order }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function createAnnouncementAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      createAnnouncementCommand,
      {
        eventId: ev.id,
        title: String(form.get('title') ?? ''),
        body: String(form.get('body') ?? ''),
        audience: form.get('audience') === 'holders' ? 'holders' : 'public',
        pinned: form.get('pinned') === '1',
        publish: form.get('publish') === '1',
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function updateAnnouncementAction(
  org: string,
  event: string,
  announcementId: string,
  change: { published?: boolean; pinned?: boolean },
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(
    updateAnnouncementCommand,
    { eventId: ev.id, announcementId, ...change },
    data.ctx,
    ports,
  );
  done(org, event);
}

export async function deleteAnnouncementAction(
  org: string,
  event: string,
  announcementId: string,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(deleteAnnouncementCommand, { eventId: ev.id, announcementId }, data.ctx, ports);
  done(org, event);
}

export interface AiDraftState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  readonly kind?: DraftKind;
  readonly text?: string;
  readonly balance?: number;
  readonly retryMinutes?: number;
}

/**
 * M1.4f "Draft with AI": a preview only. Rate limited per device and per member of the org; the
 * credit is spent by the ai module (which checks the permission, the entitlement and the
 * balance). Nothing is saved until the organizer accepts.
 */
export async function draftWithAiAction(
  org: string,
  event: string,
  kind: DraftKind,
  notes: string,
): Promise<AiDraftState> {
  const { data, event: ev } = await loadEvent(org, event);
  // Bursts: per device, and per member per event (monthly credits are the hard cap per org).
  const limit = await limitAction('aiDraft', { identity: `${data.org.id}:${data.session.userId}:${ev.id}` });
  if (!limit.allowed) return { ok: false, code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  try {
    const res = await draftEventCopy(data.ctx, ports, aiDrafter(), {
      eventId: ev.id,
      kind,
      notes: String(notes ?? '').slice(0, MAX_NOTES_LENGTH),
      locale: await getLocale(),
    });
    return { ok: true, code: null, kind: res.kind, text: res.text, balance: res.balance };
  } catch (err) {
    const f = failure(err);
    return { ok: false, code: f.code, ...(f.reason ? { reason: f.reason } : {}) };
  }
}

/** Accept a (possibly edited) draft: the tagline, or a new text/FAQ section. */
export async function acceptDraftAction(
  org: string,
  event: string,
  kind: DraftKind,
  text: string,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  // Arguments of a Server Action come from the browser: check them like form fields.
  if (!DRAFT_KINDS.includes(kind) || typeof text !== 'string')
    return { ok: false, code: 'validation_failed', fields: ['text'] };
  const t = await getTranslations('aiDraft');
  try {
    if (kind === 'tagline')
      await executeCommand(
        updateEventCommand,
        { eventId: ev.id, tagline: text.trim() || null },
        data.ctx,
        ports,
      );
    else
      await executeCommand(
        addSectionCommand,
        kind === 'faq'
          ? { eventId: ev.id, title: t('faqTitle'), kind: 'faq', content: { items: parseFaqText(text) } }
          : { eventId: ev.id, title: t('aboutTitle'), kind: 'text', content: { markdown: text } },
        data.ctx,
        ports,
      );
  } catch (err) {
    return textError(err) ?? failure(err);
  }
  done(org, event);
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  return success();
}
