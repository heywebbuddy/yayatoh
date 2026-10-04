import { getAlertRuleQuery, isRuleMoney, RULE_MEASURES } from '@yayatoh/analytics';
import { listEventsQuery } from '@yayatoh/events';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AlertRuleForm } from '@/components/analytics-pro-forms.tsx';
import { AnalyticsTabs } from '@/components/analytics-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { thresholdText } from '@/lib/rule-threshold.ts';
import { ruleCurrencies } from '@/server/analytics-pro.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { updateRuleAction } from '../actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('analyticsPro.rules');
  return { title: t('editTitle') };
}

/** Edit one organizer alert rule (M6.2b; `alerts:manage`, money rules also `finance:read`). */
export default async function EditAlertRulePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; ruleId: string }>;
}) {
  const { locale, org, ruleId } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('analytics_pro') || !roleCan(data.role, 'alerts:manage')) notFound();
  if (!/^[0-9a-f-]{36}$/i.test(ruleId)) notFound();
  const t = await getTranslations('analyticsPro.rules');
  const rule = await executeQuery(getAlertRuleQuery, { ruleId }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const canMoney = roleCan(data.role, 'finance:read');
  const events = await executeQuery(listEventsQuery, {}, data.ctx, ports);
  const measures = RULE_MEASURES.filter((m) => canMoney || !isRuleMoney(m));
  return (
    <>
      <PageHeader title={t('editTitle')} description={rule.name} />
      <AnalyticsTabs org={org} current="alerts" />
      <Link
        href={`/o/${org}/analytics/alerts`}
        className="min-h-6 self-start text-body font-semibold text-primary"
      >
        {t('back')}
      </Link>
      <AlertRuleForm
        action={updateRuleAction.bind(null, org, rule.id)}
        mode="edit"
        measures={measures}
        moneyMeasures={measures.filter((m) => isRuleMoney(m))}
        events={events.map((e) => ({ id: e.id, name: e.name }))}
        currencies={ruleCurrencies(data, events)}
        initial={{
          name: rule.name,
          measure: rule.measure,
          condition: rule.condition,
          threshold: thresholdText(rule.threshold, rule.measure, rule.condition, rule.currency),
          windowDays: rule.windowDays,
          currency: rule.currency,
          eventId: rule.eventId ?? '',
          severity: rule.severity,
          quietHours: rule.quietHours,
        }}
      />
    </>
  );
}
