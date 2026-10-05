import type { ReviewerHomeDto } from '@yayatoh/program';
import { Card, EmptyState, Label, PageHeader, SectionHeader, StatusPill, Tag } from '@yayatoh/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PortalFrame } from '@/components/portal-shell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';

/**
 * The call-for-papers reviewer's frame (M5.3b): the event, who is signed in, sign out. A reviewer
 * is a portal account (P5-7): no console, only the submissions assigned to them.
 */
export async function ReviewerShell({
  data,
  title,
  children,
}: {
  data: ReviewerHomeDto;
  title: string;
  children: ReactNode;
}) {
  const t = await getTranslations('cfpReview');
  const locale = await getLocale();
  return (
    <PortalFrame eventName={data.event.name}>
      <PageHeader
        eyebrow={<Label>{t('portalTitle')}</Label>}
        title={title}
        tag={<Tag>{data.event.name}</Tag>}
        meta={
          <span>
            {formatEventDateRange(data.event.startsAt.toISOString(), data.event.endsAt.toISOString(), {
              locale,
              currency: 'USD',
              timeZone: data.event.timezone,
            })}
          </span>
        }
      />
      {children}
    </PortalFrame>
  );
}

/** The reviewer's home: the proposals assigned to them, with their score so far. */
export async function ReviewerHome({ data }: { data: ReviewerHomeDto }) {
  const t = await getTranslations('cfpReview');
  const todo = data.submissions.filter((s) => s.myScore === null && !s.decided).length;
  return (
    <ReviewerShell data={data} title={t('welcome', { name: data.reviewer.name })}>
      <p className="m-0 text-body text-ink-2">
        {data.blind ? t('introBlind') : t('intro')} {t('signedInAs', { email: data.reviewer.email })}
      </p>
      <section aria-labelledby="assigned-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="assigned-heading"
          title={t('assignedHeading', { count: todo })}
          count={data.submissions.length}
        />
        {data.submissions.length === 0 ? (
          <EmptyState title={t('noneTitle')} description={t('noneDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {data.submissions.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-col gap-2">
                  <h3 className="m-0 text-card">
                    <Link
                      href={`/event-portal/reviews/${s.id}`}
                      className="text-ink underline-offset-4 hover:text-primary-ink hover:underline"
                    >
                      {s.title}
                    </Link>
                  </h3>
                  <p className="m-0 flex flex-wrap items-center gap-2 text-caption text-ink-2">
                    <span>
                      {t('minutes', { count: s.durationMinutes })}
                      {s.track ? ` · ${s.track}` : ''}
                    </span>
                    <StatusPill
                      tone={s.decided ? 'neutral' : s.myScore === null ? 'waiting' : 'success'}
                      label={
                        s.decided
                          ? t('statusDecided')
                          : s.myScore === null
                            ? t('statusTodo')
                            : t('statusScored', { score: s.myScore })
                      }
                    />
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ReviewerShell>
  );
}
