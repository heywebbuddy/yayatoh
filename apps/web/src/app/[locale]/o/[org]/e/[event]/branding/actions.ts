'use server';

import { EventDesign, setEventDetailsCommand } from '@yayatoh/events';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
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
  const parsed = EventDesign.safeParse({
    theme: form.get('theme') ?? undefined,
    headingFont: form.get('headingFont') ?? undefined,
    heroLayout: form.get('heroLayout') ?? undefined,
    heroVideoUrl: video || null,
  });
  // A link the page cannot embed would silently show the cover: refuse it instead.
  if (!parsed.success || (video && !parseHeroVideo(video))) return { ok: false, code: 'validation_failed' };
  try {
    await executeCommand(setEventDetailsCommand, { eventId: ev.id, design: parsed.data }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}`, 'layout');
    revalidatePath(`/events/${ev.slug}`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}
