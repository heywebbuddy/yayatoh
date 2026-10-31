import { Alert, Button, Card, PageHeader, Select, StatusPill } from '@yayatoh/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { CONTACT_STATUSES, getContactMessage } from '@/server/platform-site.ts';
import { actorNames } from '@/server/signup-codes.ts';
import { requireStaff } from '@/server/staff.ts';
import { replyMessageAction, updateMessageAction } from '../../content/site-actions.ts';

/** One contact message: its text, status and private notes, and a reply by email. */
export default async function ContactMessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('content');
  const { id } = await params;
  const sp = await searchParams;
  const t = await getTranslations('contactMessages');
  const m = await getContactMessage(staff.actor, id);
  if (!m) notFound();
  const names = await actorNames(m.repliedBy ? [m.repliedBy] : []);
  return (
    <Shell staff={staff}>
      <PageHeader
        title={m.subject}
        description={`${m.name} · ${m.email}`}
        actions={
          <Link href="/contact-messages" className="text-body underline underline-offset-4">
            {t('back')}
          </Link>
        }
      />
      <div aria-live="polite" className="flex flex-col gap-2">
        {sp.done ? (
          <Alert tone="info" title={t(`done.${sp.done === 'replied' ? 'replied' : 'saved'}`)} />
        ) : null}
        {sp.error ? (
          <Alert
            title={t(`error.${sp.error === 'mail' ? 'mail' : sp.error === 'empty' ? 'empty' : 'invalid'}`)}
          />
        ) : null}
      </div>
      <Card size="panel" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill
            tone={m.status === 'new' ? 'waiting' : m.status === 'replied' ? 'success' : 'neutral'}
            label={t(`status.${m.status}`)}
          />
          <span className="text-caption text-ink-2">
            {t('received', {
              when: m.createdAt.toISOString().slice(0, 16).replace('T', ' '),
              locale: m.locale,
            })}
          </span>
        </div>
        <p className="m-0 whitespace-pre-wrap text-body [overflow-wrap:anywhere]">{m.message}</p>
      </Card>
      {m.lastReply ? (
        <Card size="panel" className="flex flex-col gap-2">
          <h2 className="text-section">{t('lastReply')}</h2>
          <p className="m-0 text-caption text-ink-2">
            {t('repliedBy', {
              by: names.get(m.repliedBy ?? '') ?? m.repliedBy ?? '',
              when: m.repliedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '',
            })}
          </p>
          <p className="m-0 whitespace-pre-wrap text-body [overflow-wrap:anywhere]">{m.lastReply}</p>
        </Card>
      ) : null}
      <Card size="panel">
        <form action={replyMessageAction.bind(null, m.id)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('reply')}
            <textarea name="reply" required rows={7} maxLength={4000} className="field w-full" />
            <span className="text-caption font-normal text-ink-2">{t('replyHint', { email: m.email })}</span>
          </label>
          <Button type="submit" className="self-start">
            {t('send')}
          </Button>
        </form>
      </Card>
      <Card size="panel">
        <form action={updateMessageAction.bind(null, m.id)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-body font-semibold sm:max-w-xs">
            {t('statusLabel')}
            <Select
              name="status"
              defaultValue={m.status}
              options={CONTACT_STATUSES.map((k) => ({
                value: k,
                label: t(`status.${k}`),
                text: t(`status.${k}`),
              }))}
            />
          </label>
          <label className="flex flex-col gap-2 text-body font-semibold">
            {t('notes')}
            <textarea
              name="notes"
              rows={4}
              maxLength={4000}
              defaultValue={m.notes}
              className="field w-full"
            />
            <span className="text-caption font-normal text-ink-2">{t('notesHint')}</span>
          </label>
          <Button type="submit" variant="secondary" className="self-start">
            {t('saveStatus')}
          </Button>
        </form>
      </Card>
    </Shell>
  );
}
