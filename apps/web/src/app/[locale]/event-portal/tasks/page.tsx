import { PORTAL_FILE_MAX_BYTES } from '@yayatoh/media';
import { Card, EmptyState, StatusPill } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { completeTaskAction } from '@/app/[locale]/event-portal/actions.ts';
import { PortalFileUpload } from '@/components/portal-forms.tsx';
import { PortalShell, PortalSignedOut } from '@/components/portal-shell.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { formatMoment } from '@/lib/portal-format.ts';
import { loadSpeakerPortal } from '@/server/portal.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'speakerPortal' });
  return { title: t('nav.tasks'), robots: { index: false, follow: false } };
}

const ACCEPT =
  '.pdf,.pptx,.docx,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The speaker's tasks (M5.3a): due dates in the event's zone, a file, an agreement or a tick. */
export default async function SpeakerTasksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const portal = await loadSpeakerPortal();
  if (!portal) return <PortalSignedOut />;
  const { data } = portal;
  const t = await getTranslations('speakerPortal');
  const tz = data.event.timezone;
  const now = Date.now();
  const fileErrors = {
    no_file: t('errors.noFile'),
    too_large: t('errors.fileTooLarge'),
    unsupported_type: t('errors.fileType'),
    already_done: t('errors.alreadyDone'),
  };
  return (
    <PortalShell data={data} active="tasks" title={t('nav.tasks')}>
      {data.tasks.length === 0 ? (
        <EmptyState title={t('noTasksTitle')} description={t('noTasksDescription')} />
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {data.tasks.map((x) => {
            const overdue = x.status === 'open' && x.dueAt.getTime() <= now;
            return (
              <li key={x.assigneeId}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="m-0 text-card text-ink">{x.title}</h2>
                    <StatusPill
                      tone={x.status === 'done' ? 'success' : overdue ? 'danger' : 'waiting'}
                      label={x.status === 'done' ? t('done') : overdue ? t('overdue') : t('open')}
                    />
                  </div>
                  <p className="text-caption text-ink-2">
                    {x.status === 'done' && x.completedAt
                      ? t('completedOn', { date: formatMoment(x.completedAt, locale, tz) })
                      : t('due', { date: formatMoment(x.dueAt, locale, tz) })}
                  </p>
                  {x.instructions ? <p className="whitespace-pre-line text-body">{x.instructions}</p> : null}
                  {x.fileName ? (
                    <p className="text-caption text-ink-2">{t('yourFile', { name: x.fileName })}</p>
                  ) : null}
                  {x.status === 'open' && x.kind === 'upload' ? (
                    <PortalFileUpload
                      purpose="task_answer"
                      assigneeId={x.assigneeId}
                      label={t('fileLabel', { title: x.title })}
                      hint={t('fileHint')}
                      accept={ACCEPT}
                      submitLabel={t('upload')}
                      successLabel={t('uploaded')}
                      errors={fileErrors}
                      maxBytes={PORTAL_FILE_MAX_BYTES}
                    />
                  ) : null}
                  {x.kind === 'agreement' && x.agreementText ? (
                    <div className="max-h-64 overflow-y-auto rounded-card border border-line bg-surface-2 p-3">
                      <p className="whitespace-pre-line text-body">{x.agreementText}</p>
                    </div>
                  ) : null}
                  {x.status === 'open' && x.kind !== 'upload' ? (
                    <ProgramForm
                      action={completeTaskAction.bind(null, x.assigneeId)}
                      idPrefix={`task-${x.assigneeId}`}
                      submitLabel={x.kind === 'agreement' ? t('accept') : t('markDone')}
                      successLabel={t('completed')}
                      errors={{
                        accept: t('errors.acceptRequired'),
                        accept_required: t('errors.acceptRequired'),
                      }}
                      fields={[
                        {
                          kind: 'checkboxes',
                          name: 'accept',
                          label: x.kind === 'agreement' ? t('agreementLegend') : t('confirmLegend'),
                          options: [
                            {
                              value: 'yes',
                              label:
                                x.kind === 'agreement'
                                  ? t('acceptLabel', { title: x.title })
                                  : t('confirmLabel', { title: x.title }),
                            },
                          ],
                        },
                      ]}
                    />
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PortalShell>
  );
}
