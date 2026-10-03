import { duplicatePairQuery, MERGE_FIELDS, strictestConsent } from '@yayatoh/crm';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, Card, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { PeopleActionForm } from '../../people/action-form.tsx';
import { dismissPairAction, mergePairAction } from '../../people/actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('people');
  return { title: t('compare.title') };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Consent = 'granted' | 'withdrawn' | 'unknown_legacy' | null;

/**
 * Review one possible duplicate (M6.1a): both records side by side, which one stays, each field
 * from either record (default: the most recent non-empty value), the merged consent (an opt-out
 * wins), then merge (undo for 30 days) or "not the same person".
 */
export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; candidate: string }>;
}) {
  const { locale, org, candidate } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'contacts:read') || !UUID.test(candidate))
    notFound();
  const t = await getTranslations('people');
  let pair: Awaited<ReturnType<typeof loadPair>>;
  try {
    pair = await loadPair(data, candidate);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const canMerge = roleCan(data.role, 'contacts:merge');
  const open = pair.status === 'open' && pair.a.live && pair.b.live;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const records = [pair.a, pair.b] as const;
  const other = (id: string) => (id === pair.a.id ? pair.b.id : pair.a.id);
  const defaultFor = (f: (typeof MERGE_FIELDS)[number]) =>
    pair.defaultChoices[f] === 'target' ? pair.defaultTargetId : other(pair.defaultTargetId);
  const label = (n: number) => t('compare.record', { n });
  const fieldValue = (r: (typeof records)[number], f: (typeof MERGE_FIELDS)[number]) =>
    f === 'name' ? r.name : f === 'email' ? r.email : f === 'phone' ? r.phone : r.company;
  const consentWord = (c: Consent) => t(`consent.${c ?? 'none'}`);
  const merged = {
    email: strictestConsent(pair.a.emailConsent, pair.b.emailConsent).status,
    sms: strictestConsent(pair.a.smsConsent, pair.b.smsConsent).status,
  };
  const messages = {
    'invalid_state:already_merged': t('merge.errors.alreadyMerged'),
    'invalid_state:erased': t('merge.errors.erased'),
    'invalid_state:owners_missing': t('merge.errors.unavailable'),
    'validation_failed:keep': t('merge.errors.keep'),
    forbidden: t('errors.forbidden'),
    not_found: t('merge.errors.alreadyMerged'),
  };
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/audiences/duplicates`} className="underline underline-offset-2">
            {t('duplicates.title')}
          </Link>
        }
        title={t('compare.title')}
        description={t('compare.description', {
          score: pair.score,
          reasons: pair.reasons.map((x) => t(`reasons.${x}`)).join(', '),
        })}
      />
      {open ? null : <Alert tone="info" title={t('compare.resolved')} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {records.map((r, i) => (
          <Card key={r.id} className="flex flex-col gap-3">
            <h2 className="text-section">
              {label(i + 1)}
              {r.id === pair.defaultTargetId ? ' ' : null}
              {r.id === pair.defaultTargetId ? (
                <span className="ms-2 text-caption text-zinc-600">{t('compare.older')}</span>
              ) : null}
            </h2>
            <dl className="flex flex-col gap-1">
              {(
                [
                  ['name', r.name],
                  ['email', r.email],
                  ['phone', r.phone],
                  ['company', r.company],
                  ['added', day.format(r.createdAt)],
                  ['emailConsent', consentWord(r.emailConsent)],
                  ['smsConsent', consentWord(r.smsConsent)],
                  ['history', t('compare.entries', { count: r.timelineEntries })],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-3 border-b border-zinc-100 py-1"
                >
                  <dt className="text-body text-zinc-600">{t(`fields.${k}`)}</dt>
                  <dd className="text-body break-all text-end">{v ?? t('fields.empty')}</dd>
                </div>
              ))}
            </dl>
            <Link
              href={`/o/${org}/audiences/people/${r.id}`}
              className="self-start underline underline-offset-2"
            >
              {t('compare.openTimeline', { record: label(i + 1) })}
            </Link>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-2" data-testid="merged-consent">
        <h2 className="text-section">{t('compare.consentTitle')}</h2>
        <p className="text-body">
          {t('compare.consentEmail', { status: consentWord(merged.email) })}
          {' · '}
          {t('compare.consentSms', { status: consentWord(merged.sms) })}
        </p>
        <p className="text-caption text-zinc-600">{t('compare.consentRule')}</p>
      </Card>

      {canMerge && open ? (
        <>
          <PeopleActionForm
            action={mergePairAction.bind(null, org, { a: pair.a.id, b: pair.b.id })}
            messages={messages}
            className="flex flex-col gap-4"
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="text-section">{t('compare.keepLegend')}</legend>
              <p className="text-caption text-zinc-600">{t('compare.keepHint')}</p>
              {records.map((r, i) => (
                <label key={r.id} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="keep"
                    value={r.id}
                    defaultChecked={r.id === pair.defaultTargetId}
                    className="size-6 accent-ink"
                  />
                  <span className="text-body">
                    {t('compare.keepOption', { record: label(i + 1), email: r.email })}
                  </span>
                </label>
              ))}
            </fieldset>
            {MERGE_FIELDS.map((f) => (
              <fieldset key={f} className="flex flex-col gap-2">
                <legend className="text-body font-medium">{t(`compare.fieldLegend.${f}`)}</legend>
                {records.map((r, i) => (
                  <label key={r.id} className="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name={f}
                      value={r.id}
                      defaultChecked={r.id === defaultFor(f)}
                      className="size-6 accent-ink"
                    />
                    <span className="text-body break-all">
                      {t('compare.fieldOption', {
                        record: label(i + 1),
                        value: fieldValue(r, f) ?? t('fields.empty'),
                      })}
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="flex flex-col gap-1">
              <Button type="submit" className="self-start">
                {t('merge.submit')}
              </Button>
              <p className="text-caption text-zinc-600">{t('merge.hint')}</p>
            </div>
          </PeopleActionForm>
          <PeopleActionForm action={dismissPairAction.bind(null, org, pair.id)} messages={{}}>
            <Button type="submit" variant="ghost">
              {t('compare.dismiss')}
            </Button>
          </PeopleActionForm>
        </>
      ) : null}
    </>
  );
}

function loadPair(data: Awaited<ReturnType<typeof loadConsole>>, candidateId: string) {
  return executeQuery(duplicatePairQuery, { candidateId }, data.ctx, ports);
}
