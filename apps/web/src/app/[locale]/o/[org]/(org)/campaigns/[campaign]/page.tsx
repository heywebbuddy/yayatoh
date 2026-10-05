import { listSegmentsQuery } from '@yayatoh/audiences';
import {
  type CampaignDto,
  campaignResultsQuery,
  estimateReachQuery,
  getCampaignQuery,
  type ReachDto,
  starterContent,
} from '@yayatoh/campaigns';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CampaignEditor } from '@/components/campaign-editor.tsx';
import { AudiencePanel, LifecyclePanel, SendPanel, TestSendPanel } from '@/components/campaign-panels.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { aiComposeSetup } from '@/server/ai-compose.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { builderData } from '../../audiences/builder-data.ts';
import {
  deleteCampaignAction,
  draftCampaignAiAction,
  lifecycleAction,
  previewCampaignAction,
  saveCampaignAction,
  scheduleCampaignAction,
  sendNowAction,
  setAudienceAction,
  testSendAction,
} from '../actions.ts';
import { STATUS_TONE } from '../status.ts';

type Params = { locale: string; org: string; campaign: string };

async function load(org: string, id: string) {
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:read')) notFound();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  try {
    return { data, campaign: await executeQuery(getCampaignQuery, { campaignId: id }, data.ctx, ports) };
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { org, campaign } = await params;
  const { campaign: c } = await load(org, campaign);
  const t = await getTranslations('campaigns');
  return { title: t('detailTitle', { name: c.name }) };
}

const OPS: Record<CampaignDto['status'], readonly ('unschedule' | 'pause' | 'resume' | 'cancel')[]> = {
  draft: [],
  scheduled: ['unschedule', 'cancel'],
  sending: ['pause', 'cancel'],
  paused: ['resume', 'cancel'],
  sent: [],
  cancelled: [],
};

/** One campaign (M3.6b): the block editor (drafts), audience and reach, test sends, schedule/send, results. */
export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ created?: string; done?: string }>;
}) {
  const { locale, org, campaign: id } = await params;
  setRequestLocale(locale);
  const { data, campaign: c } = await load(org, id);
  const { created, done } = await searchParams;
  const t = await getTranslations('campaigns');
  const tn = await getTranslations('notifications.reasons');
  const canWrite = roleCan(data.role, 'marketing:write');
  const canSend = roleCan(data.role, 'messages:send');
  const draft = c.status === 'draft';
  const { events } = await builderData(data, locale);
  const segments =
    canWrite && draft ? await executeQuery(listSegmentsQuery, { withCounts: false }, data.ctx, ports) : [];
  let reach: ReachDto | null = null;
  let reachError: string | null = null;
  if ((draft || c.status === 'scheduled') && c.audience) {
    try {
      reach = await executeQuery(estimateReachQuery, { campaignId: c.id }, data.ctx, ports);
    } catch (err) {
      if (!isDomainError(err)) throw err;
      reachError = String(err.details?.reason ?? err.code);
    }
  }
  const results = c.startedAt
    ? await executeQuery(campaignResultsQuery, { campaignId: c.id }, data.ctx, ports)
    : null;
  const preview = await previewCampaignAction(org, c.id, null);
  // M6.12b: AI drafting for those who may send (and when the org has the AI module).
  const ai =
    draft && canWrite && canSend && data.modules.has('ai') && c.channel === 'email'
      ? { setup: await aiComposeSetup(data.ctx), draft: draftCampaignAiAction.bind(null, org, c.id) }
      : undefined;
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const n = (v: number) => formatNumber(v, locale);
  const audienceName = !c.audience
    ? t('noAudience')
    : c.audience.kind === 'segment'
      ? t('audienceSegment')
      : t('audienceTemplate', { template: t(`templates.${c.audience.templateKey}`) });

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/campaigns`} className="underline underline-offset-2">
            {t('title')}
          </Link>
        }
        title={c.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-3">
            <StatusDot status={STATUS_TONE[c.status]} label={t(`statuses.${c.status}`)} />
            <span>{t(`channels.${c.channel}`)}</span>
            {c.scheduledAt && c.status === 'scheduled' ? (
              <span>{t('scheduledFor', { when: when.format(c.scheduledAt) })}</span>
            ) : null}
          </span>
        }
      />
      {created ? <Alert tone="info" title={t('created')} /> : null}
      {done && ['unschedule', 'pause', 'resume', 'cancel'].includes(done) ? (
        <Alert tone="info" title={t(`done.${done as 'pause'}`)} />
      ) : null}
      {c.failureReason ? (
        <Alert
          title={t('failed', {
            reason: t.has(`errors.${c.failureReason}`) ? t(`errors.${c.failureReason}`) : t('errors.unknown'),
          })}
        />
      ) : null}
      {!canWrite ? <p className="text-caption text-ink-2">{t('readOnly')}</p> : null}

      {draft && canWrite ? (
        <CampaignEditor
          campaignId={c.id}
          channel={c.channel}
          initial={{ name: c.name, locale: c.locale, content: c.content ?? starterContent() }}
          events={events}
          save={saveCampaignAction.bind(null, org, c.id)}
          preview={previewCampaignAction.bind(null, org, c.id)}
          initialPreview={preview}
          {...(ai ? { ai } : {})}
        />
      ) : (
        <section aria-labelledby="campaign-preview" className="flex flex-col gap-3">
          <h2 id="campaign-preview" className="text-section">
            {t('previewTitle')}
          </h2>
          {preview.ok && preview.src ? (
            <>
              <p className="text-caption text-ink-2">
                {t('previewSubject', { subject: preview.subject ?? '' })}
              </p>
              {preview.sms ? (
                <p className="whitespace-pre-line rounded-card border border-line bg-surface-2 px-4 py-3 text-body">
                  {preview.sms}
                </p>
              ) : null}
              <iframe
                title={t('previewFrame', { frame: t('frames.desktop') })}
                src={preview.src}
                sandbox=""
                className="h-[560px] w-full rounded-card border border-line bg-surface"
              />
            </>
          ) : (
            <p className="text-body text-ink-2">{t('errors.previewFailed')}</p>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <section aria-labelledby="audience-heading" className="flex flex-col gap-3">
            <h2 id="audience-heading" className="text-section">
              {t('audienceTitle')}
            </h2>
            <p className="text-body">{audienceName}</p>
            {draft && canWrite ? (
              <AudiencePanel
                action={setAudienceAction.bind(null, org, c.id)}
                segments={segments.map((s) => ({ id: s.id, name: s.name }))}
                events={events}
                current={
                  c.audience?.kind === 'segment'
                    ? { kind: 'segment', segmentId: c.audience.segmentId }
                    : c.audience?.kind === 'template'
                      ? { kind: 'template', templateKey: c.audience.templateKey, eventId: c.audience.eventId }
                      : null
                }
              />
            ) : null}
            {reach ? (
              <div className="flex flex-col gap-2" data-testid="reach">
                <p className="text-body font-medium">
                  {t('reach', { eligible: reach.eligible, total: reach.total })}
                </p>
                {reach.excluded.length ? (
                  <table className="text-caption">
                    <caption className="text-start text-ink-2">{t('excludedCaption')}</caption>
                    <tbody>
                      {reach.excluded.map((x) => (
                        <tr key={x.reason}>
                          <th scope="row" className="py-1 pe-4 text-start font-normal">
                            {t(`reasons.${x.reason}`)}
                          </th>
                          <td className="py-1 text-end font-mono">{n(x.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            ) : reachError ? (
              <p className="text-body text-danger">
                {t.has(`errors.${reachError}`) ? t(`errors.${reachError}`) : t('errors.unknown')}
              </p>
            ) : null}
          </section>
        </Card>

        {canSend && (draft || c.status === 'scheduled') && c.channel === 'email' ? (
          <Card>
            <section aria-labelledby="test-heading" className="flex flex-col gap-3">
              <h2 id="test-heading" className="text-section">
                {t('testTitle')}
              </h2>
              <TestSendPanel action={testSendAction.bind(null, org, c.id)} />
            </section>
          </Card>
        ) : null}

        {canSend && draft ? (
          <Card>
            <section aria-labelledby="send-heading" className="flex flex-col gap-3">
              <h2 id="send-heading" className="text-section">
                {t('sendTitle')}
              </h2>
              <SendPanel
                schedule={scheduleCampaignAction.bind(null, org, c.id)}
                sendNow={sendNowAction.bind(null, org, c.id)}
                timeZone={data.org.timezone}
                eligible={reach?.eligible ?? null}
              />
            </section>
          </Card>
        ) : null}

        {canSend && OPS[c.status].length ? (
          <Card>
            <section aria-labelledby="controls-heading" className="flex flex-col gap-3">
              <h2 id="controls-heading" className="text-section">
                {t('controlsTitle')}
              </h2>
              <LifecyclePanel action={lifecycleAction.bind(null, org, c.id)} ops={OPS[c.status]} />
            </section>
          </Card>
        ) : null}
      </div>

      {results ? (
        <section aria-labelledby="results-heading" className="flex flex-col gap-3">
          <h2 id="results-heading" className="text-section">
            {t('resultsTitle')}
          </h2>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="results">
            {(
              [
                ['recipients', results.reach.eligible],
                ['sent', results.sent],
                ['delivered', results.delivered],
                ['bounced', results.bounced],
                ['complained', results.complained],
                ['opened', results.opened],
                ['clicked', results.clicked],
                ['unsubscribed', results.unsubscribed],
                ['waiting', results.waiting + results.pending],
                ['notSent', results.notSent + results.failed],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1 rounded-card border border-line p-4">
                <dt className="text-caption text-ink-2">{t(`metrics.${k}`)}</dt>
                <dd className="font-mono text-section">{v === null ? t('notTracked') : n(v)}</dd>
              </div>
            ))}
          </dl>
          {results.reach.excluded.length ? (
            <table className="text-caption">
              <caption className="text-start text-ink-2">{t('excludedCaption')}</caption>
              <tbody>
                {results.reach.excluded.map((x) => (
                  <tr key={x.reason}>
                    <th scope="row" className="py-1 pe-4 text-start font-normal">
                      {t(`reasons.${x.reason}`)}
                    </th>
                    <td className="py-1 text-end font-mono">{n(x.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {results.reasons.length ? (
            <table className="text-caption">
              <caption className="text-start text-ink-2">{t('gateCaption')}</caption>
              <tbody>
                {results.reasons.map((x) => (
                  <tr key={`${x.channel}-${x.reason}`}>
                    <th scope="row" className="py-1 pe-4 text-start font-normal">
                      {tn.has(x.reason) ? tn(x.reason) : x.reason}
                    </th>
                    <td className="py-1 text-end font-mono">{n(x.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {draft && canWrite ? (
        <form action={deleteCampaignAction.bind(null, org, c.id)}>
          <Button type="submit" variant="secondary" size="sm">
            {t('deleteDraft')}
          </Button>
        </form>
      ) : null}
    </>
  );
}
