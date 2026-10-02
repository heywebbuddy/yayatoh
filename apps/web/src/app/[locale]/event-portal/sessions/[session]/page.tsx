import { Card } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { proposeSessionAction } from '@/app/[locale]/event-portal/actions.ts';
import { Markdown } from '@/components/markdown.tsx';
import { PortalChangeStatus } from '@/components/portal-change-status.tsx';
import { PortalShell, PortalSignedOut } from '@/components/portal-shell.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { formatSessionTime } from '@/lib/portal-format.ts';
import { loadSpeakerPortal } from '@/server/portal.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'speakerPortal' });
  return { title: t('sessionTitle'), robots: { index: false, follow: false } };
}

/**
 * One of the speaker's own sessions (M5.3a). Any other id — another speaker's session, another
 * event's, a guess — is a 404: the portal only ever lists the speaker's own.
 */
export default async function SpeakerSessionPage({
  params,
}: {
  params: Promise<{ locale: string; session: string }>;
}) {
  const { locale, session } = await params;
  setRequestLocale(locale);
  const portal = await loadSpeakerPortal();
  if (!portal) return <PortalSignedOut />;
  const { data } = portal;
  const s = data.sessions.find((x) => x.id === session);
  if (!s) notFound();
  const t = await getTranslations('speakerPortal');
  const tp = await getTranslations('program');
  return (
    <PortalShell data={data} active={null} title={s.title}>
      <Card className="flex flex-col gap-2">
        <p className="text-body">{formatSessionTime(s.startsAt, s.endsAt, locale, data.event.timezone)}</p>
        <p className="text-caption text-zinc-600">
          {s.room ? t('room', { room: s.room }) : t('roomTba')}
          {s.track ? ` · ${t('track', { track: s.track })}` : ''}
        </p>
        {s.coSpeakers.length ? (
          <p className="text-caption text-zinc-600">
            {t('withCoSpeakers', { names: s.coSpeakers.join(', ') })}
          </p>
        ) : null}
        {s.description ? <Markdown source={s.description} /> : null}
      </Card>
      {s.change ? <PortalChangeStatus change={s.change} /> : null}
      <section aria-labelledby="session-edit-heading">
        <Card size="panel" className="flex flex-col gap-3">
          <h2 id="session-edit-heading" className="text-section">
            {t('suggestChanges')}
          </h2>
          <p className="text-caption text-zinc-600">{t('sessionApprovalHint')}</p>
          <ProgramForm
            action={proposeSessionAction.bind(null, s.id)}
            idPrefix="portal-session"
            submitLabel={t('sendForApproval')}
            successLabel={t('sentForApproval')}
            errors={{ title: t('errors.sessionTitle'), no_change: t('noChange') }}
            fields={[
              {
                kind: 'text',
                name: 'title',
                label: tp('sessionTitle'),
                required: true,
                maxLength: 160,
                defaultValue: s.title,
              },
              {
                kind: 'textarea',
                name: 'description',
                label: tp('description'),
                hint: tp('markdownHint'),
                rows: 6,
                defaultValue: s.description,
              },
            ]}
          />
        </Card>
      </section>
    </PortalShell>
  );
}
