import { listSegmentsQuery } from '@yayatoh/audiences';
import {
  audienceSyncQuery,
  consentChangesQuery,
  isListConnector,
  type ProviderList,
  providerLists,
} from '@yayatoh/integrations';
import { type Ctx, executeQuery } from '@yayatoh/kernel';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  EmptyState,
  SectionHeader,
  Select,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';
import { saveAudienceAction } from '../marketing-actions.ts';

const AUDIENCE_FEEDBACK = new Set([
  'saved',
  'list_required',
  'provider_unavailable',
  'validation_failed',
  'forbidden',
  'invalid_state',
  'not_found',
  'read_only_freeze',
  'internal',
]);

/**
 * M6.4d: the marketing connectors' part of a connection page. Mailchimp and Klaviyo: which
 * audience is pushed and to which list (consent rules first). HubSpot: what syncs (contacts both
 * ways, marketing events with registration and attendance). All three: the consent changes their
 * pulls brought back, with what each changed here.
 */
export async function MarketingSection({
  org,
  connector,
  name,
  connectionId,
  ctx,
  locale,
  timezone,
  canManage,
  active,
  feedback,
}: {
  org: string;
  connector: string;
  name: string;
  connectionId: string;
  ctx: Ctx;
  locale: string;
  timezone: string;
  canManage: boolean;
  active: boolean;
  feedback: string | null;
}) {
  const t = await getTranslations('integrations.marketing');
  const list = isListConnector(connector);
  const [settings, changes] = await Promise.all([
    list ? executeQuery(audienceSyncQuery, { connectionId }, ctx, ports) : null,
    executeQuery(consentChangesQuery, { connectionId }, ctx, ports),
  ]);
  // Saved audiences need the marketing module and `messages:read`; without them, everyone with consent.
  const segments =
    list && canManage
      ? await executeQuery(listSegmentsQuery, { withCounts: false }, ctx, ports).catch(() => [])
      : [];
  let lists: ProviderList[] = [];
  let listsFailed = false;
  const auth = integrationAuth();
  if (list && canManage && active && auth)
    lists = await providerLists(ctx, auth, connectionId).catch(() => {
      listsFailed = true;
      return [];
    });
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });
  const shown = feedback && AUDIENCE_FEEDBACK.has(feedback) ? feedback : feedback ? 'internal' : null;
  const segmentName = settings?.segmentId
    ? (segments.find((s) => s.id === settings.segmentId)?.name ?? t('audience.savedSegment'))
    : t('audience.everyone');
  return (
    <>
      {list ? (
        <section aria-labelledby="audience-heading" className="flex flex-col gap-3">
          <SectionHeader
            id="audience-heading"
            title={t('audience.title')}
            description={t('audience.help', { name })}
          />
          <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
            {shown === 'saved' ? <Alert tone="success" title={t('audience.saved')} /> : null}
            {shown && shown !== 'saved' ? (
              <Alert tone="danger" title={t(`audience.feedback.${shown}`)} />
            ) : null}
          </div>
          {settings?.segmentMissing ? <Alert tone="warning" title={t('audience.segmentMissing')} /> : null}
          <Card className="flex flex-col gap-4">
            {settings ? (
              <dl
                className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body"
                data-testid="audience-current"
              >
                <dt className="text-ink-2">{t('audience.segment')}</dt>
                <dd className="m-0">{segmentName}</dd>
                <dt className="text-ink-2">{t('audience.list', { name })}</dt>
                <dd className="m-0">{settings.listName}</dd>
              </dl>
            ) : (
              <EmptyState
                title={t('audience.emptyTitle')}
                description={canManage ? t('audience.emptyManage', { name }) : t('audience.emptyRead')}
                action={
                  canManage && active ? (
                    <a href="#audience-form" className={buttonClass('secondary')}>
                      {t('audience.chooseNow')}
                    </a>
                  ) : (
                    <Link href={`/o/${org}/integrations`} className={buttonClass('secondary')}>
                      {t('audience.allIntegrations')}
                    </Link>
                  )
                }
              />
            )}
            <p className="m-0 text-body text-ink-2">{t('consentRule')}</p>
            {canManage && active ? (
              listsFailed ? (
                <Alert tone="danger" title={t('audience.feedback.provider_unavailable')} />
              ) : (
                <form
                  id="audience-form"
                  action={saveAudienceAction.bind(null, org, connectionId)}
                  className="flex flex-wrap items-end gap-3"
                  aria-label={t('audience.formLabel')}
                >
                  <Select
                    id="audience-segment"
                    name="segment"
                    label={t('audience.segment')}
                    defaultValue={settings?.segmentId ?? ''}
                  >
                    <option value="">{t('audience.everyone')}</option>
                    {segments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    id="audience-list"
                    name="list"
                    label={t('audience.list', { name })}
                    defaultValue={settings?.listId ?? lists[0]?.id ?? ''}
                    required
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                  <Button type="submit">{t('audience.save')}</Button>
                </form>
              )
            ) : null}
          </Card>
        </section>
      ) : (
        <section aria-labelledby="hubspot-heading" className="flex flex-col gap-3">
          <SectionHeader id="hubspot-heading" title={t('hubspot.title')} />
          <Card className="flex flex-col gap-2">
            <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-body">
              <li>{t('hubspot.contacts')}</li>
              <li>{t('hubspot.events')}</li>
              <li>{t('hubspot.attendance')}</li>
            </ul>
            <p className="m-0 text-body text-ink-2">{t('consentRule')}</p>
          </Card>
        </section>
      )}
      <section aria-labelledby="consent-changes-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="consent-changes-heading"
          title={t('changes.title', { name })}
          description={t('changes.help', { name })}
          count={changes.length}
        />
        <Table
          caption={t('changes.caption', { name })}
          rowKey={(r) => r.id}
          rows={changes}
          stackOnPhone
          empty={t('changes.empty', { name })}
          columns={[
            {
              key: 'who',
              header: t('changes.who'),
              cell: (r) => (r.name ? `${r.name} (${r.email})` : r.email),
            },
            {
              key: 'change',
              header: t('changes.change'),
              cell: (r) => (
                <StatusPill
                  tone={r.change === 'unsubscribed' ? 'neutral' : 'waiting'}
                  label={t(`changes.kinds.${r.change}`)}
                />
              ),
            },
            {
              key: 'applied',
              header: t('changes.applied'),
              cell: (r) =>
                [
                  r.consentWithdrawn ? t('changes.withdrawn') : null,
                  r.suppressed ? t('changes.suppressed') : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || t('changes.already'),
            },
            { key: 'when', header: t('changes.when'), cell: (r) => when.format(r.createdAt) },
          ]}
        />
      </section>
    </>
  );
}
