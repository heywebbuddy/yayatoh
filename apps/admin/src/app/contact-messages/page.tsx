import { Card, EmptyState, PageHeader, StatusPill } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { CONTACT_STATUSES, type ContactStatus, listContactMessages } from '@/server/platform-site.ts';
import { requireStaff } from '@/server/staff.ts';

/** The Contact page inbox: new, replied and closed messages. */
export default async function ContactMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const staff = await requireStaff('content');
  const sp = await searchParams;
  const t = await getTranslations('contactMessages');
  const status = (CONTACT_STATUSES as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as ContactStatus)
    : null;
  const { rows, counts } = await listContactMessages(staff.actor, status);
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <nav aria-label={t('filter')} className="flex flex-wrap gap-2">
        {[null, ...CONTACT_STATUSES].map((k) => (
          <Link
            key={k ?? 'all'}
            href={k ? `/contact-messages?status=${k}` : '/contact-messages'}
            aria-current={k === status ? 'page' : undefined}
            className="inline-flex min-h-11 items-center rounded-control px-4 py-2 text-body font-bold text-ink-2 hover:bg-surface-3 aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-ink"
          >
            {k ? `${t(`status.${k}`)} (${counts[k]})` : t('all')}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card size="panel">
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {rows.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/contact-messages/${m.id}`}
                    className="text-body font-bold underline underline-offset-4 [overflow-wrap:anywhere]"
                  >
                    {m.subject}
                  </Link>
                  <span className="text-caption text-ink-2 [overflow-wrap:anywhere]">
                    {m.name} · {m.email} · {m.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
                <StatusPill
                  tone={m.status === 'new' ? 'waiting' : m.status === 'replied' ? 'success' : 'neutral'}
                  label={t(`status.${m.status}`)}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
