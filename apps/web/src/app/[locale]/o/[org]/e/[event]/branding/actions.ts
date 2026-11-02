'use server';

import {
  EventDesign,
  eventDetailsQuery,
  isDefaultPageStyle,
  isUploadedVideo,
  PageStyle,
  setEventDetailsCommand,
} from '@yayatoh/events';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { parseHeroVideo } from '@/lib/hero-video.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import type { SettingsState } from '../../../(org)/settings/actions.ts';

/** Per-event branding (agreement §3): the event's own accent colour; empty → the org's colour. */
export async function eventBrandAction(
  org: string,
  event: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { data, event: ev } = await loadEvent(org, event, 'branding');
  const raw = String(form.get('brandColor') ?? '').trim();
  try {
    await executeCommand(
      setEventDetailsCommand,
      { eventId: ev.id, brandColor: raw || null },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}`, 'layout');
    revalidatePath(`/events/${ev.slug}`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}

/** Design options for the public event page: theme, heading font, hero layout and video link. */
export async function eventDesignAction(
  org: string,
  event: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { data, event: ev } = await loadEvent(org, event, 'branding');
  const video = String(form.get('heroVideoUrl') ?? '').trim();
  const poster = String(form.get('heroVideoUrlPoster') ?? '').trim();
  const uploaded = isUploadedVideo(video);
  const parsed = EventDesign.safeParse({
    theme: form.get('theme') ?? undefined,
    headingFont: form.get('headingFont') ?? undefined,
    heroLayout: form.get('heroLayout') ?? undefined,
    heroVideoUrl: video || null,
    heroVideoPoster: uploaded && poster ? poster : null,
    assistant: form.get('assistant') === 'on',
    // The page colours and layout are saved by their own form: keep them.
    page: (await executeQuery(eventDetailsQuery, { eventId: ev.id }, data.ctx, ports)).design.page,
  });
  // A link the page cannot embed would silently show the cover: refuse it instead.
  if (!parsed.success || (video && !uploaded && !parseHeroVideo(video)) || (uploaded && !poster))
    return { ok: false, code: 'validation_failed' };
  try {
    await executeCommand(setEventDetailsCommand, { eventId: ev.id, design: parsed.data }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}`, 'layout');
    revalidatePath(`/events/${ev.slug}`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}

/**
 * Page colours and layout (organizer page design): accent, band, section and text colours, text
 * size, and section order and visibility. Colours are sanitized to `#rrggbb` by the schema (junk is
 * dropped, not stored); contrast is corrected when the public page renders.
 */
export async function pageStyleAction(
  org: string,
  event: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { data, event: ev } = await loadEvent(org, event, 'branding');
  const list = (k: string) =>
    String(form.get(k) ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const color = (k: string) => String(form.get(k) ?? '').trim() || null;
  const parsed = PageStyle.safeParse({
    accent: color('accent'),
    accent2: color('accent2'),
    band: color('band'),
    sectionBg: color('sectionBg'),
    text: color('text'),
    scale: form.get('scale') ?? undefined,
    order: list('order'),
    hidden: list('hidden'),
  });
  if (!parsed.success) return { ok: false, code: 'validation_failed' };
  try {
    const current = await executeQuery(eventDetailsQuery, { eventId: ev.id }, data.ctx, ports);
    const page = isDefaultPageStyle(parsed.data) ? null : parsed.data;
    await executeCommand(
      setEventDetailsCommand,
      { eventId: ev.id, design: { ...current.design, page } },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}`, 'layout');
    revalidatePath(`/events/${ev.slug}`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}
