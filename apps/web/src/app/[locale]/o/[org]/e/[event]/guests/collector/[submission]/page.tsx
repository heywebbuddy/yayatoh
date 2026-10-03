import { collectorMergePreviewQuery, guestListQuery, MERGE_FIELDS } from '@yayatoh/guests';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, navLabelKey, PROFILES } from '@yayatoh/platform';
import { Button, buttonClass, Card, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { GuestsCrumbs } from '../../rsvp/nav.tsx';
import { mergeSubmissionAction } from '../actions.ts';

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Merge a collector submission into an existing party (M4.1f), field by field: the party's
 * address, email and phone next to the submitted ones, a choice per field (keep or use), and the
 * submitted people the party doesn't have yet (ticked to add). Nothing else of the party changes.
 * `guests:write` only.
 */
export default async function MergeSubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string; submission: string }>;
  searchParams: Promise<{ party?: string }>;
}) {
  const { locale, org, event, submission } = await params;
  const { party } = await searchParams;
  setRequestLocale(locale);
  if (!UUID.test(submission)) notFound();
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'guests');
  if (!nav || !navIncludes(profile, data.modules, 'guests') || !can('guests:write')) notFound();
  const t = await getTranslations('collectorHost');
  const tr = await getTranslations();
  const list = await executeQuery(guestListQuery, { eventId: ev.id, limit: 1 }, data.ctx, ports);
  const partyId = party && UUID.test(party) ? party : (list.partyOptions[0]?.id ?? null);
  const back = `/o/${org}/e/${event}/guests/collector`;
  const preview = partyId
    ? await executeQuery(
        collectorMergePreviewQuery,
        { eventId: ev.id, submissionId: submission, partyId },
        data.ctx,
        ports,
      ).catch((err) => {
        if (isDomainError(err) && err.code === 'not_found') return null;
        throw err;
      })
    : null;
  if (partyId && !preview) notFound();

  const s = preview?.submission;
  const pending = s?.status === 'pending';
  const fields: FieldSpec[] = [];
  if (preview && s && pending) {
    for (const f of MERGE_FIELDS) {
      if (!s[f]) continue;
      fields.push({
        kind: 'select',
        name: f,
        label: t(`fields.${f}`),
        options: [
          { value: 'keep', label: preview.current[f] ? t('keep') : t('keepEmpty') },
          { value: 'use', label: t('use') },
        ],
        defaultValue: preview.current[f] ? 'keep' : 'use',
      });
    }
    if (preview.newMembers.length)
      fields.push({
        kind: 'checkboxes',
        name: 'members',
        label: t('addPeople'),
        options: preview.newMembers.map((i) => {
          const m = s.members[i];
          return { value: String(i), label: [m?.firstName, m?.lastName].filter(Boolean).join(' ') };
        }),
        defaultValues: preview.newMembers.map(String),
      });
  }
  const value = (v: string | null) => v ?? t('empty');
  const people = s
    ? s.members.map((m) => [m.firstName, m.lastName].filter(Boolean).join(' ')).join(', ')
    : '';
  const rows = [
    ...MERGE_FIELDS.map((f) => ({
      key: f as string,
      label: t(`fields.${f}`),
      party: value(preview?.current[f] ?? null),
      sent: value(s?.[f] ?? null),
    })),
    { key: 'people', label: t('people'), party: t('empty'), sent: people },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={
          <GuestsCrumbs
            org={org}
            event={event}
            orgName={data.org.name}
            eventName={ev.name}
            guestsLabel={tr(navLabelKey(profile, nav))}
            trail={[{ label: t('title'), href: back }, ...(s?.household ? [{ label: s.household }] : [])]}
          />
        }
        title={t('mergeTitle', { household: s?.household ?? '' })}
        description={t('mergeSubtitle')}
      />
      {!preview || !s ? (
        <EmptyState
          title={t('noParties')}
          description={t('noPartiesHint')}
          action={
            <Link href={back} className={buttonClass('secondary')}>
              {t('backToQueue')}
            </Link>
          }
        />
      ) : !pending ? (
        <EmptyState
          title={t('alreadyDecided')}
          description={t('alreadyDecidedHint')}
          action={
            <Link href={back} className={buttonClass('secondary')}>
              {t('backToQueue')}
            </Link>
          }
        />
      ) : (
        <>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 glass"
          >
            <div className="flex min-w-48 flex-col gap-1.5">
              <label htmlFor="merge-party" className="text-[13px] font-bold text-ink">
                {t('mergeInto')}
              </label>
              <select id="merge-party" name="party" defaultValue={preview.party.id} className="field pe-9">
                {list.partyOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary">
              {t('switchParty')}
            </Button>
          </form>
          <section aria-labelledby="merge-compare-heading" className="flex flex-col gap-3">
            <h2 id="merge-compare-heading" className="m-0 text-section text-ink">
              {t('compareTitle', { party: preview.party.name })}
            </h2>
            <Table
              caption={t('compareCaption', { party: preview.party.name })}
              rowKey={(r) => r.key}
              rows={rows}
              columns={[
                {
                  key: 'field',
                  header: t('field'),
                  cell: (r) => <span className="font-bold text-ink">{r.label}</span>,
                },
                {
                  key: 'party',
                  header: t('onParty'),
                  cell: (r) => <span className="whitespace-pre-line">{r.party}</span>,
                },
                {
                  key: 'sent',
                  header: t('submittedValue'),
                  cell: (r) => <span className="whitespace-pre-line">{r.sent}</span>,
                },
              ]}
            />
            <Card size="panel">
              {fields.length === 0 ? (
                <p className="m-0 pb-3 text-body text-ink">{t('nothingToMerge')}</p>
              ) : null}
              <ProgramForm
                action={mergeSubmissionAction.bind(null, org, event, submission, preview.party.id)}
                fields={fields}
                idPrefix="merge"
                submitLabel={t('mergeSubmit', { party: preview.party.name })}
                successLabel={t('merged')}
                errors={{ party_full: t('errors.partyFull'), too_many: t('errors.tooMany') }}
              />
            </Card>
          </section>
        </>
      )}
    </>
  );
}
