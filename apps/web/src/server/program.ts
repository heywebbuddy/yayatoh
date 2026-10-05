import 'server-only';
import { executeQuery } from '@yayatoh/kernel';
import { navIncludes } from '@yayatoh/platform';
import { type ProgramDto, programQuery, type ScheduleWarningDto } from '@yayatoh/program';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadEvent } from './console.ts';
import { ports } from './ports.ts';

export type ProgramSection = 'sessions' | 'speakers' | 'exhibitors' | 'sponsors';

/**
 * A program page (M1.4f): only for profiles whose navigation lists the section (with the org's
 * modules). Other profiles, foreign and unknown events are a 404.
 */
export async function loadProgramPage(org: string, event: string, section: ProgramSection) {
  const { data, event: ev, profile, can } = await loadEvent(org, event, section);
  if (!navIncludes(profile, data.modules, section)) notFound();
  const program = await executeQuery(programQuery, { eventId: ev.id }, data.ctx, ports);
  // M5.7b: engagement scores name attendees, so their link needs `attendees:read`.
  return { data, ev, program, canWrite: can('events:write'), canReadPeople: can('attendees:read') };
}

/** Localized schedule warnings (M1.4f conflicts), naming the other session, room or speaker. */
export async function warningMessages(
  warnings: readonly ScheduleWarningDto[],
  program: ProgramDto,
): Promise<string[]> {
  const t = await getTranslations('program.warnings');
  const title = (id: string | null) => program.sessions.find((s) => s.id === id)?.title ?? '—';
  return warnings.map((w) =>
    w.kind === 'room_overlap'
      ? t('room_overlap', {
          room: program.rooms.find((r) => r.id === w.roomId)?.name ?? '—',
          other: title(w.otherId),
        })
      : w.kind === 'speaker_overlap'
        ? t('speaker_overlap', {
            speaker: program.speakers.find((p) => p.id === w.speakerId)?.name ?? '—',
            other: title(w.otherId),
          })
        : t('outside_event'),
  );
}
