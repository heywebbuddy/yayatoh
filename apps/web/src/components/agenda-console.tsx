import type { AgendaDto, ProgramDto, SessionAgendaDto } from '@yayatoh/program';
import { Button, Card, Label } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import {
  addStandardTypesAction,
  createSessionGroupAction,
  createSessionTypeAction,
  deleteSessionGroupAction,
  deleteSessionTypeAction,
  publishAgendaAction,
  setSessionAgendaAction,
  unpublishAgendaAction,
} from '@/app/[locale]/o/[org]/e/[event]/sessions/agenda-actions.ts';
import { type FieldSpec, ProgramForm, ScheduleWarning } from '@/components/program-form.tsx';

/**
 * M5.2a — agenda model v2 on the Sessions page: publishing state, agenda warnings, the
 * per-session type/admission/group form, and the session types and pick-one groups lists.
 * Everything is a plain form: keyboard-only by construction, no drag.
 */

const agendaErrors = async () => {
  const t = await getTranslations('agenda.errors');
  const tp = await getTranslations('program.errors');
  return {
    group_needs_optional: t('group_needs_optional'),
    has_enrollments: t('has_enrollments'),
    group_in_use: t('group_in_use'),
    unknown: tp('unknown'),
    too_many: tp('too_many'),
    name: tp('name'),
    'conflict.name': tp('nameTaken'),
  };
};

export async function AgendaPublishing({
  org,
  event,
  agenda,
  locale,
  timeZone,
  canWrite,
}: {
  org: string;
  event: string;
  agenda: AgendaDto;
  locale: string;
  timeZone: string;
  canWrite: boolean;
}) {
  const t = await getTranslations('agenda.publishing');
  const p = agenda.publication;
  const date = p.publishedAt
    ? new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(
        p.publishedAt,
      )
    : '';
  return (
    <section aria-labelledby="agenda-publishing-heading">
      <Card className="flex flex-col gap-3" data-agenda-state={p.state}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="agenda-publishing-heading" className="text-section">
            {t('heading')}
          </h2>
          <Label>{t(`badge.${p.state}`)}</Label>
        </div>
        <p className="text-body text-zinc-600" role="status">
          {t(`state.${p.state}`, { version: p.version, date })}
        </p>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {p.state !== 'published' ? (
              <form action={publishAgendaAction.bind(null, org, event)}>
                <Button type="submit">{t(p.state === 'changed' ? 'publishChanges' : 'publish')}</Button>
              </form>
            ) : null}
            {p.state !== 'draft' ? (
              <form action={unpublishAgendaAction.bind(null, org, event)}>
                <Button type="submit" variant="secondary">
                  {t(p.state === 'live' ? 'toDraft' : 'unpublish')}
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}

export async function AgendaWarnings({ messages }: { messages: readonly string[] }) {
  if (messages.length === 0) return null;
  const t = await getTranslations('agenda');
  return (
    <section aria-labelledby="agenda-warnings-heading" className="flex flex-col gap-2">
      <h2 id="agenda-warnings-heading" className="text-section">
        {t('warningsHeading', { count: messages.length })}
      </h2>
      <ul className="flex list-none flex-col gap-2 p-0">
        {messages.map((w, i) => (
          <li key={`${i}-${w}`}>
            <ScheduleWarning>{w}</ScheduleWarning>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The session card's agenda line: type · included/optional · group · enrollment, and a room label. */
export async function SessionAgendaLine({
  details,
  agenda,
  roomTooSmall,
}: {
  details: SessionAgendaDto | undefined;
  agenda: AgendaDto;
  roomTooSmall: boolean;
}) {
  const t = await getTranslations('agenda');
  if (!details) return null;
  const type = agenda.types.find((x) => x.id === details.typeId)?.name;
  const group = agenda.groups.find((x) => x.id === details.groupId)?.name;
  const parts = [
    type,
    t(details.admission),
    group,
    details.admission === 'optional' && details.capacity
      ? t('placesTaken', { enrolled: details.enrolled, capacity: details.capacity })
      : undefined,
    details.admission === 'optional' && !details.enrollmentOpen ? t('enrollmentClosed') : undefined,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-caption text-zinc-600" data-agenda-line>
        {parts.join(' · ')}
      </p>
      {roomTooSmall ? <Label>{t('roomTooSmallLabel')}</Label> : null}
    </div>
  );
}

/** The per-session agenda form (type, included/optional, group, enrollment open or closed). */
export async function SessionAgendaForm({
  org,
  event,
  sessionId,
  title,
  details,
  agenda,
}: {
  org: string;
  event: string;
  sessionId: string;
  title: string;
  details: SessionAgendaDto | undefined;
  agenda: AgendaDto;
}) {
  const t = await getTranslations('agenda.settings');
  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'typeId',
      label: t('type'),
      defaultValue: details?.typeId ?? '',
      options: [
        { value: '', label: t('noType') },
        ...agenda.types.map((x) => ({ value: x.id, label: x.name })),
      ],
    },
    {
      kind: 'select',
      name: 'admission',
      label: t('admission'),
      hint: t('admissionHint'),
      defaultValue: details?.admission ?? 'included',
      options: [
        { value: 'included', label: t('includedOption') },
        { value: 'optional', label: t('optionalOption') },
      ],
    },
    {
      kind: 'select',
      name: 'groupId',
      label: t('group'),
      hint: t('groupHint'),
      defaultValue: details?.groupId ?? '',
      options: [
        { value: '', label: t('noGroup') },
        ...agenda.groups.map((x) => ({ value: x.id, label: x.name })),
      ],
    },
    {
      kind: 'select',
      name: 'enrollment',
      label: t('enrollment'),
      defaultValue: details && !details.enrollmentOpen ? 'closed' : 'open',
      options: [
        { value: 'open', label: t('open') },
        { value: 'closed', label: t('closed') },
      ],
    },
  ];
  return (
    <section
      aria-label={t('summary', { title })}
      className="flex flex-col gap-3 border-t border-zinc-100 pt-3"
    >
      <h5 className="text-caption font-medium text-zinc-700">{t('summary', { title })}</h5>
      <ProgramForm
        action={setSessionAgendaAction.bind(null, org, event, sessionId)}
        fields={fields}
        idPrefix={`agenda-${sessionId}`}
        submitLabel={t('save')}
        successLabel={t('saved')}
        errors={await agendaErrors()}
      />
    </section>
  );
}

/** Session types and pick-one groups: lists with delete, and add forms. */
export async function TypesAndGroups({
  org,
  event,
  agenda,
  program,
  canWrite,
}: {
  org: string;
  event: string;
  agenda: AgendaDto;
  program: ProgramDto;
  canWrite: boolean;
}) {
  const t = await getTranslations('agenda');
  const tp = await getTranslations('program');
  const errors = await agendaErrors();
  const titleOf = (id: string) => program.sessions.find((s) => s.id === id)?.title ?? '';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section aria-labelledby="session-types-heading" className="flex flex-col gap-3">
        <h2 id="session-types-heading" className="text-section">
          {t('types.heading')}
        </h2>
        {agenda.types.length === 0 ? (
          <p className="text-body text-zinc-500">{t('types.empty')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-1 p-0">
            {agenda.types.map((x) => (
              <li
                key={x.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 py-1"
              >
                <span className="text-body">{x.name}</span>
                {canWrite ? (
                  <form action={deleteSessionTypeAction.bind(null, org, event, x.id)}>
                    <Button type="submit" variant="ghost" size="sm">
                      {tp('deleteNamed', { name: x.name })}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <Card className="flex flex-col gap-3">
            {agenda.types.length === 0 ? (
              <form
                action={addStandardTypesAction.bind(null, org, event)}
                className="flex flex-col items-start gap-1"
              >
                <Button type="submit" variant="secondary">
                  {t('types.addStandard')}
                </Button>
                <p className="text-caption text-zinc-500">{t('types.standardHint')}</p>
              </form>
            ) : null}
            <ProgramForm
              action={createSessionTypeAction.bind(null, org, event)}
              fields={[{ kind: 'text', name: 'name', label: t('types.name'), required: true, maxLength: 60 }]}
              idPrefix="new-session-type"
              submitLabel={t('types.add')}
              successLabel={t('types.added')}
              errors={errors}
              reset
            />
          </Card>
        ) : null}
      </section>
      <section aria-labelledby="session-groups-heading" className="flex flex-col gap-3">
        <h2 id="session-groups-heading" className="text-section">
          {t('groups.heading')}
        </h2>
        <p className="text-caption text-zinc-500">{t('groups.intro')}</p>
        {agenda.groups.length === 0 ? (
          <p className="text-body text-zinc-500">{t('groups.empty')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {agenda.groups.map((g) => (
              <li
                key={g.id}
                className="flex flex-col gap-1 border-b border-zinc-100 pb-2"
                data-group={g.name}
              >
                <span className="text-body font-medium">{g.name}</span>
                <span className="text-caption text-zinc-600">
                  {t('groups.sessions', { count: g.sessionIds.length })}
                  {g.sessionIds.length > 0 ? `: ${g.sessionIds.map(titleOf).join(', ')}` : ''}
                </span>
                {canWrite ? (
                  <ProgramForm
                    action={deleteSessionGroupAction.bind(null, org, event, g.id)}
                    fields={[]}
                    idPrefix={`delete-group-${g.id}`}
                    submitLabel={tp('deleteNamed', { name: g.name })}
                    successLabel={t('groups.deleted')}
                    errors={errors}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <Card className="flex flex-col gap-3">
            <ProgramForm
              action={createSessionGroupAction.bind(null, org, event)}
              fields={[
                { kind: 'text', name: 'name', label: t('groups.name'), required: true, maxLength: 80 },
              ]}
              idPrefix="new-session-group"
              submitLabel={t('groups.add')}
              successLabel={t('groups.added')}
              errors={errors}
              reset
            />
          </Card>
        ) : null}
      </section>
    </div>
  );
}
