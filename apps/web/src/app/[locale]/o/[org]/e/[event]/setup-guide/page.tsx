import { Card, PageHeader, ProgressRing } from '@yayatoh/ui';
import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { readinessPercent } from '@/lib/readiness.ts';
import { loadEvent } from '@/server/console.ts';
import { loadReadiness } from '@/server/readiness.ts';

/**
 * The setup guide (readiness engine v1, M1.4f): every rule for this event's profile, done or not,
 * with a link to the page that fixes it.
 */
export default async function SetupGuidePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  await loadEvent(org, event);
  const rules = await loadReadiness(org, event);
  const t = await getTranslations();
  const percent = readinessPercent(rules);
  const base = `/o/${org}/e/${event}`;
  const left = rules.filter((r) => !r.done).length;
  return (
    <>
      <PageHeader title={t('setupGuide.title')} description={t('setupGuide.subtitle')} />
      <Card size="panel" className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <ProgressRing value={percent} label={t('dashboard.readinessPercent', { value: percent })} />
          <p className="text-body text-zinc-600" aria-live="polite">
            {left === 0 ? t('setupGuide.allDone') : t('setupGuide.left', { count: left })}
          </p>
        </div>
        <ol aria-label={t('setupGuide.checklist')} className="flex list-none flex-col gap-2 p-0">
          {rules.map((r) => (
            <li
              key={r.key}
              data-rule={r.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-zinc-200 px-4 py-3"
            >
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full ${r.done ? 'bg-green-500 text-white' : 'border border-zinc-300'}`}
                >
                  {r.done ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
                </span>
                <span className="flex flex-col">
                  <span className={r.done ? 'text-body text-zinc-900' : 'text-body font-medium'}>
                    {t(`readiness.${r.key}`)}
                  </span>
                  <span className="text-caption text-zinc-500">
                    {r.done ? t('readiness.done') : t(`setupGuide.hint.${r.key}`)}
                  </span>
                </span>
              </span>
              {r.done ? null : (
                <Link
                  href={r.path ? `${base}/${r.path}` : base}
                  className="inline-flex min-h-10 items-center rounded-pill border border-zinc-200 px-4 text-caption"
                >
                  {t('setupGuide.fix', { rule: t(`readiness.${r.key}`) })}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
