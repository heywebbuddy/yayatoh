import { collectorMergePreviewQuery, guestListQuery, MERGE_FIELDS } from '@yayatoh/guests';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, PROFILES } from '@yayatoh/platform';
import { Button, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { mergeSubmissionAction } from '../actions.ts';

const UUID = /^[0-9a-f-]{36}$/;
const control = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

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

  return (
    <>
      <PageHeader
        title={t('mergeTitle', { household: s?.household ?? '' })}
        description={t('mergeSubtitle')}
      />
      <Link href={back} className="min-h-6 self-start py-1 text-caption underline">
        {t('backToQueue')}
      </Link>
      {!preview || !s ? (
        <EmptyState title={t('noParties')} description={t('noPartiesHint')} />
      ) : !pending ? (
        <EmptyState title={t('alreadyDecided')} description={t('alreadyDecidedHint')} />
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="merge-party" className="text-caption text-zinc-600">
                {t('mergeInto')}
              </label>
              <select id="merge-party" name="party" defaultValue={preview.party.id} className={control}>
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
            <h2 id="merge-compare-heading" className="text-section">
              {t('compareTitle', { party: preview.party.name })}
            </h2>
            <Card className="overflow-x-auto">
              <table className="w-full text-start text-caption">
                <caption className="sr-only">{t('compareCaption', { party: preview.party.name })}</caption>
                <thead>
                  <tr className="text-zinc-600">
                    <th scope="col" className="py-1 pe-3 text-start font-medium">
                      {t('field')}
                    </th>
                    <th scope="col" className="py-1 pe-3 text-start font-medium">
                      {t('onParty')}
                    </th>
                    <th scope="col" className="py-1 text-start font-medium">
                      {t('submittedValue')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MERGE_FIELDS.map((f) => (
                    <tr key={f} className="border-t border-zinc-100 align-top">
                      <th scope="row" className="py-1 pe-3 text-start font-medium">
                        {t(`fields.${f}`)}
                      </th>
                      <td className="py-1 pe-3 whitespace-pre-line">{value(preview.current[f])}</td>
                      <td className="py-1 whitespace-pre-line">{value(s[f])}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-zinc-100 align-top">
                    <th scope="row" className="py-1 pe-3 text-start font-medium">
                      {t('people')}
                    </th>
                    <td className="py-1 pe-3">—</td>
                    <td className="py-1">
                      {s.members.map((m) => [m.firstName, m.lastName].filter(Boolean).join(' ')).join(', ')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
            <Card size="panel">
              {fields.length === 0 ? <p className="pb-3 text-body">{t('nothingToMerge')}</p> : null}
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
