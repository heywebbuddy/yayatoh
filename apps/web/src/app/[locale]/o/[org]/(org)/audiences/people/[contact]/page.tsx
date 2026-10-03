import { personTimelineQuery } from '@yayatoh/audiences';
import { personQuery, TIMELINE_KINDS, type TimelineKind } from '@yayatoh/crm';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, Select } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { PeopleActionForm } from '../action-form.tsx';
import { undoMergeAction } from '../actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('people');
  return { title: t('person.title') };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const field = 'min-h-10 w-full rounded-pill border border-line bg-white px-4 text-body';

/**
 * One person (M6.1a): their record, the merges into it (undo for 30 days) and the timeline, one
 * chronological feed from the crm projection, filtered by kind and event, newest first.
 */
export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; contact: string }>;
  searchParams: Promise<{
    kind?: string;
    event?: string;
    before?: string;
    merged?: string;
    undone?: string;
    from?: string;
  }>;
}) {
  const { locale, org, contact } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'contacts:read') || !UUID.test(contact))
    notFound();
  const sp = await searchParams;
  const t = await getTranslations('people');
  let person: Awaited<ReturnType<typeof loadPerson>>;
  try {
    person = await loadPerson(data, contact);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  // A merged-away record: open the person it was merged into.
  if (person.mergedInto)
    redirect({
      href: `/o/${org}/audiences/people/${person.mergedInto}?from=${contact}`,
      locale: await getLocale(),
    });
  const kind = (TIMELINE_KINDS as readonly string[]).includes(sp.kind ?? '')
    ? (sp.kind as TimelineKind)
    : null;
  const eventId = sp.event && UUID.test(sp.event) ? sp.event : null;
  const [beforeIso, beforeId] = (sp.before ?? '').split('_');
  const beforeAt = beforeIso ? new Date(beforeIso) : null;
  const before =
    beforeAt && !Number.isNaN(beforeAt.getTime()) && beforeId && UUID.test(beforeId)
      ? { at: beforeAt, id: beforeId }
      : undefined;
  const timeline = await executeQuery(
    personTimelineQuery,
    {
      contactId: contact,
      ...(kind ? { kinds: [kind] } : {}),
      ...(eventId ? { eventId } : {}),
      ...(before ? { before } : {}),
      limit: 25,
    },
    data.ctx,
    ports,
  );
  const canMerge = roleCan(data.role, 'contacts:merge');
  const tz = data.org.timezone;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: tz });
  const at = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  const c = person.contact;
  const display = c.name ?? c.email;
  const filters = new URLSearchParams({ ...(kind ? { kind } : {}), ...(eventId ? { event: eventId } : {}) });
  const olderHref = timeline.next
    ? `/o/${org}/audiences/people/${contact}?${new URLSearchParams({
        ...Object.fromEntries(filters),
        before: `${timeline.next.at.toISOString()}_${timeline.next.id}`,
      }).toString()}`
    : null;
  const undoMessages = {
    'invalid_state:undo_expired': t('undo.errors.expired'),
    'invalid_state:undo_blocked': t('undo.errors.blocked'),
    'invalid_state:erased': t('undo.errors.erased'),
    'invalid_state:undone': t('undo.errors.undone'),
    forbidden: t('errors.forbidden'),
  };
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/audiences/people`} className="underline underline-offset-2">
            {t('title')}
          </Link>
        }
        title={display}
        description={c.name ? c.email : undefined}
      />
      <div aria-live="polite" className="flex flex-col gap-2">
        {sp.merged ? <Alert tone="info" title={t('merge.done')} /> : null}
        {sp.undone && UUID.test(sp.undone) ? (
          <Alert tone="info" title={t('undo.done')}>
            <Link href={`/o/${org}/audiences/people/${sp.undone}`} className="underline underline-offset-2">
              {t('undo.openOther')}
            </Link>
          </Alert>
        ) : null}
        {sp.from ? <Alert tone="info" title={t('person.mergedHere')} /> : null}
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('person.details')}</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {(
            [
              ['email', c.email],
              ['phone', c.phone],
              ['company', c.company],
              ['added', day.format(c.createdAt)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line py-1">
              <dt className="text-body text-ink-2">{t(`fields.${k}`)}</dt>
              <dd className="text-body break-all text-end">{v ?? t('fields.empty')}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {person.merges.length > 0 ? (
        <section aria-labelledby="merges-heading" className="flex flex-col gap-3">
          <h2 id="merges-heading" className="text-section">
            {t('merges.title')}
          </h2>
          <ul className="flex flex-col gap-2">
            {person.merges.map((m) => {
              const who = m.source
                ? m.source.name
                  ? `${m.source.name} (${m.source.email})`
                  : m.source.email
                : t('merges.erased');
              return (
                <li key={m.id}>
                  <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <p className="text-body">{t('merges.line', { who, when: day.format(m.mergedAt) })}</p>
                      <p className="text-caption text-ink-2">
                        {m.status === 'undone' && m.undoneAt
                          ? t('merges.undoneOn', { when: day.format(m.undoneAt) })
                          : t('merges.moved', { moved: m.moved })}
                        {m.canUndo ? ` ${t('merges.undoUntil', { when: day.format(m.undoUntil) })}` : ''}
                      </p>
                    </div>
                    {canMerge && m.canUndo ? (
                      <PeopleActionForm
                        action={undoMergeAction.bind(null, org, m.id)}
                        messages={undoMessages}
                      >
                        <Button type="submit" variant="secondary" aria-label={t('undo.submitFor', { who })}>
                          {t('undo.submit')}
                        </Button>
                      </PeopleActionForm>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
        <h2 id="timeline-heading" className="text-section">
          {t('timeline.title')}
        </h2>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timeline-kind" className="text-caption text-ink-2">
              {t('timeline.kind')}
            </label>
            <Select id="timeline-kind" name="kind" defaultValue={kind ?? ''} className={field}>
              <option value="">{t('timeline.allKinds')}</option>
              {TIMELINE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timeline-event" className="text-caption text-ink-2">
              {t('timeline.event')}
            </label>
            <Select id="timeline-event" name="event" defaultValue={eventId ?? ''} className={field}>
              <option value="">{t('timeline.allEvents')}</option>
              {timeline.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            {t('timeline.filter')}
          </Button>
        </form>
        {timeline.rows.length === 0 ? (
          kind || eventId ? (
            <EmptyState
              title={t('timeline.noMatchTitle')}
              description={t('timeline.noMatchDescription')}
              action={
                <Link
                  href={`/o/${org}/audiences/people/${contact}`}
                  className={buttonClass('secondary', 'md')}
                >
                  {t('timeline.showEverything')}
                </Link>
              }
            />
          ) : (
            <EmptyState
              title={t('timeline.emptyTitle')}
              description={t('timeline.emptyDescription')}
              action={
                <Link href={`/o/${org}/audiences/people`} className={buttonClass('secondary', 'md')}>
                  {t('timeline.backToPeople')}
                </Link>
              }
            />
          )
        ) : (
          <ol className="flex flex-col gap-2" aria-label={t('timeline.listLabel', { name: display })}>
            {timeline.rows.map((r) => (
              <li
                key={r.id}
                data-testid="timeline-entry"
                className="flex flex-col gap-1 rounded-card border border-line bg-white px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-body font-medium">{t(`kinds.${r.kind}`)}</span>
                  <span className="text-caption text-ink-2">
                    {[r.eventName, r.label].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 text-start sm:text-end">
                  {r.amountMinor !== null && r.currency ? (
                    <span className="font-mono text-body">
                      {formatMoney(money(r.amountMinor, r.currency), locale)}
                    </span>
                  ) : null}
                  <time dateTime={r.occurredAt.toISOString()} className="text-caption text-ink-2">
                    {at.format(r.occurredAt)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
        {olderHref ? (
          <Link href={olderHref} className={`${buttonClass('secondary', 'sm')} self-start`}>
            {t('timeline.older')}
          </Link>
        ) : null}
      </section>
    </>
  );
}

function loadPerson(data: Awaited<ReturnType<typeof loadConsole>>, contactId: string) {
  return executeQuery(personQuery, { contactId }, data.ctx, ports);
}
