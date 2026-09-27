'use server';

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
  updateSectionCommand,
} from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

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
