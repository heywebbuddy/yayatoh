import {
  ALERT_CATEGORIES,
  alertRoutingQuery,
  myAlertSettingsQuery,
  ROUTING_CHANNELS,
  salesTargetQuery,
} from '@yayatoh/alerts';
import { listEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { ORG_ROLES, roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  AlertPhoneForm,
  AlertRoutingForm,
  type RoutingRow,
  SalesTargetForm,
} from '@/components/alert-settings-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { savePhoneAction, saveRoutingAction, saveTargetAction } from '../actions.ts';

/**
 * Alert settings (M3.2b): every member's own number for alert texts; the per-role routing (who
 * hears about which group of alerts, on which channels), which owners and admins change and
 * everyone who can read the team sees; and ticket targets for the org's upcoming events (sales
 * pace), for people who can edit events.
 */
export default async function AlertSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const mine = await executeQuery(myAlertSettingsQuery, {}, data.ctx, ports);
  const canSeeRouting = roleCan(data.role, 'members:read');
  const routing = canSeeRouting ? await executeQuery(alertRoutingQuery, {}, data.ctx, ports) : [];
  const rows: RoutingRow[] = ORG_ROLES.map((role) => ({
    role,
    roleLabel: t(`roles.${role}`),
    cells: ALERT_CATEGORIES.map((category) => {
      const on = new Set(routing.find((c) => c.role === role && c.category === category)?.channels ?? []);
      return {
        category,
        groupLabel: t(`alerts.groups.${category}`),
        channels: ROUTING_CHANNELS.map((channel) => ({
          channel,
          label: t(`alerts.channels.${channel}`),
          on: on.has(channel),
        })),
      };
    }),
  }));
  const canTarget = roleCan(data.role, 'events:write') && roleCan(data.role, 'orders:read');
  const now = data.ctx.now.getTime();
  const upcoming = canTarget
    ? (await executeQuery(listEventsQuery, {}, data.ctx, ports)).filter(
        (e) => e.startsAt.getTime() > now && ['draft', 'published', 'postponed'].includes(e.status),
      )
    : [];
  const targets = await Promise.all(
    upcoming.slice(0, 20).map(async (e) => ({
      event: e,
      tickets: (await executeQuery(salesTargetQuery, { eventId: e.id }, data.ctx, ports)).tickets,
    })),
  );

  return (
    <>
      <PageHeader
        title={t('alerts.settings.title')}
        description={t('alerts.settings.description')}
        actions={
          <Link href={`/o/${org}/alerts`} className="inline-flex min-h-6 items-center underline">
            {t('alerts.settings.back')}
          </Link>
        }
      />
      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('alerts.settings.phone.title')}</h2>
        <AlertPhoneForm current={mine.smsPhone} action={savePhoneAction.bind(null, org)} />
      </Card>
      {canSeeRouting ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('alerts.settings.routing.title')}</h2>
          <p className="text-caption text-zinc-600">{t('alerts.settings.routing.description')}</p>
          <AlertRoutingForm
            rows={rows}
            editable={roleCan(data.role, 'members:manage')}
            action={saveRoutingAction.bind(null, org)}
          />
        </Card>
      ) : null}
      {canTarget ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('alerts.settings.targets.title')}</h2>
          <p className="text-caption text-zinc-600">{t('alerts.settings.targets.description')}</p>
          {targets.length === 0 ? (
            <p className="text-body text-zinc-600">{t('alerts.settings.targets.none')}</p>
          ) : (
            targets.map(({ event, tickets }) => (
              <SalesTargetForm
                key={event.id}
                eventId={event.id}
                eventName={event.name}
                current={tickets}
                action={saveTargetAction.bind(null, org, event.id)}
              />
            ))
          )}
        </Card>
      ) : null}
    </>
  );
}
