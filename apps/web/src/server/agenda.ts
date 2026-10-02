import 'server-only';
import type { AgendaDto, AgendaWarningDto, ProgramDto } from '@yayatoh/program';
import { getTranslations } from 'next-intl/server';

/** Localized agenda warnings (M5.2a): a room smaller than the session, a group session out of step. */
export async function agendaWarningMessages(
  warnings: readonly AgendaWarningDto[],
  program: ProgramDto,
  agenda: Pick<AgendaDto, 'groups'>,
): Promise<string[]> {
  const t = await getTranslations('agenda.warnings');
  const title = (id: string) => program.sessions.find((s) => s.id === id)?.title ?? '—';
  return warnings.map((w) =>
    w.kind === 'room_too_small'
      ? t('room_too_small', {
          room: program.rooms.find((r) => r.id === w.roomId)?.name ?? '—',
          roomCapacity: w.roomCapacity ?? 0,
          session: title(w.sessionId),
          sessionCapacity: w.sessionCapacity ?? 0,
        })
      : t('group_not_overlapping', {
          session: title(w.sessionId),
          group: agenda.groups.find((g) => g.id === w.groupId)?.name ?? '—',
        }),
  );
}
