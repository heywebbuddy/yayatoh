import { executeQuery } from '@yayatoh/kernel';
import { type PortalTaskDto, portalTaskBoardQuery } from '@yayatoh/program';
import { Alert, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { ActionButtonForm, RemindForm } from '@/components/portal-admin-forms.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { formatMoment } from '@/lib/portal-format.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import {
  assignNewSpeakersAction,
  createTaskAction,
  deleteTaskAction,
  remindMissingAction,
} from '../portal-actions.ts';

type Assignee = PortalTaskDto['assignees'][number];

/**
 * The speaker task board (M5.3a): tasks with due dates (event time zone), each speaker's status
 * and file, and "remind whoever is missing it" — the reminder goes only to speakers who have not
 * completed the task and have portal access. Viewers see the board, never the controls.
 */
export default async function SpeakerTasksBoardPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, program, canWrite } = await loadProgramPage(org, event, 'speakers');
  const t = await getTranslations('speakerTasks');
  const tn = await getTranslations('nav');
  const tasks = await executeQuery(portalTaskBoardQuery, { eventId: ev.id }, data.ctx, ports);
  const tz = ev.timezone;
  const columns = [
    { key: 'speaker', header: t('colSpeaker'), cell: (a: Assignee) => a.subjectName },
    {
      key: 'status',
      header: t('colStatus'),
      cell: (a: Assignee) => (
        <StatusDot
          status={a.status === 'done' ? 'success' : 'warning'}
          label={a.status === 'done' ? t('done') : t('missing')}
        />
      ),
    },
    {
      key: 'done',
      header: t('colDone'),
      cell: (a: Assignee) =>
        a.completedAt ? formatMoment(a.completedAt, locale, tz) : a.reachable ? '—' : t('noAccess'),
    },
    {
      key: 'file',
      header: t('colFile'),
      cell: (a: Assignee) =>
        a.fileId && a.fileName ? (
          <a href={`/api/portal-files/${org}/${a.fileId}`} className="underline underline-offset-2">
            {t('download', { name: a.fileName })}
          </a>
        ) : (
          '—'
        ),
    },
    {
      key: 'reminded',
      header: t('colReminded'),
      cell: (a: Assignee) =>
        a.remindedAt
          ? t('remindedAt', { count: a.reminderCount, date: formatMoment(a.remindedAt, locale, tz) })
          : '—',
    },
  ];
  const defaultRelease = t('releasePlaceholder');
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: tn('speakers'), href: `/o/${org}/e/${event}/speakers` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        description={t('subtitle', { zone: tz })}
      />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
      <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
        <h2 id="tasks-heading" className="text-section">
          {t('listHeading', { count: tasks.length })}
        </h2>
        {tasks.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-4 p-0">
            {tasks.map((task) => {
              const missing = task.assignees.filter((a) => a.status === 'open');
              const reachable = missing.filter((a) => a.reachable).length;
              const newSpeakers = program.speakers.filter(
                (s) => !task.assignees.some((a) => a.subjectId === s.id),
              ).length;
              return (
                <li key={task.id}>
                  <Card className="flex flex-col gap-3">
                    <h3 className="text-section">{task.title}</h3>
                    <p className="text-caption text-ink-2">
                      {t(`kinds.${task.kind}`)} · {t('due', { date: formatMoment(task.dueAt, locale, tz) })} ·{' '}
                      {t('progress', {
                        done: task.assignees.length - missing.length,
                        total: task.assignees.length,
                      })}
                    </p>
                    <Table
                      caption={t('tableCaption', { title: task.title })}
                      columns={columns}
                      rows={task.assignees}
                      rowKey={(a) => a.id}
                      empty={t('noAssignees')}
                    />
                    {canWrite ? (
                      <div className="flex flex-wrap items-start gap-3">
                        <RemindForm
                          action={remindMissingAction.bind(null, org, event, task.id)}
                          label={t('remind', { count: reachable, title: task.title })}
                          disabled={reachable === 0}
                        />
                        {newSpeakers > 0 ? (
                          <ActionButtonForm
                            action={assignNewSpeakersAction.bind(null, org, event, task.id)}
                            label={t('assignNew', { count: newSpeakers })}
                            successLabel={t('assigned')}
                          />
                        ) : null}
                        <ActionButtonForm
                          action={deleteTaskAction.bind(null, org, event, task.id)}
                          label={t('delete', { title: task.title })}
                          successLabel={t('deleted')}
                          variant="ghost"
                        />
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {canWrite ? (
        <section aria-labelledby="new-task-heading">
          <Card size="panel" className="flex flex-col gap-3">
            <h2 id="new-task-heading" className="text-section">
              {t('newTask')}
            </h2>
            <ProgramForm
              action={createTaskAction.bind(null, org, event)}
              idPrefix="new-task"
              submitLabel={t('create')}
              successLabel={t('created')}
              reset
              errors={{
                title: t('errors.title'),
                dueAt: t('errors.dueAt'),
                past: t('errors.pastDue'),
                agreementText: t('errors.agreementText'),
                too_many: t('errors.tooMany'),
              }}
              fields={[
                {
                  kind: 'select',
                  name: 'kind',
                  label: t('kindLabel'),
                  options: (['upload', 'agreement', 'confirm'] as const).map((k) => ({
                    value: k,
                    label: t(`kinds.${k}`),
                  })),
                },
                { kind: 'text', name: 'title', label: t('taskTitle'), required: true, maxLength: 120 },
                { kind: 'textarea', name: 'instructions', label: t('instructions'), rows: 3 },
                {
                  kind: 'textarea',
                  name: 'agreementText',
                  label: t('agreementText'),
                  hint: t('agreementHint'),
                  rows: 5,
                  defaultValue: defaultRelease,
                },
                { kind: 'datetime-local', name: 'dueAt', label: t('dueLabel', { zone: tz }), required: true },
              ]}
            />
          </Card>
        </section>
      ) : null}
    </>
  );
}
