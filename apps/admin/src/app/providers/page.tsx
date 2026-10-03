import { Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { providerHealth } from '@/server/providers.ts';
import { requireStaff } from '@/server/staff.ts';

export async function generateMetadata() {
  const t = await getTranslations('providers');
  return { title: t('title') };
}

const MODE_DOT = { live: 'success', ready: 'warning', off: 'neutral', fake: 'info' } as const;

/**
 * Messaging providers (M3.5b): per provider, whether it is live, its last webhook, sends and
 * errors over 24 hours, refused webhooks and the last error code; then each real provider's
 * switch-on checklist (config names, webhook seen, switched on, and the owner's steps).
 */
export default async function ProvidersPage() {
  const staff = await requireStaff('messaging');
  const t = await getTranslations('providers');
  const rows = await providerHealth(staff);
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const pct = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 });
  const name = (p: string) => (t.has(`names.${p}`) ? t(`names.${p}`) : p);
  const cols = ['provider', 'mode', 'lastWebhook', 'webhooks', 'sends', 'errorRate', 'lastError'] as const;
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <Card className="p-0">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable) */}
        <section className="overflow-x-auto" tabIndex={0} aria-label={t('tableCaption')}>
          <table className="w-full text-start text-caption">
            <caption className="sr-only">{t('tableCaption')}</caption>
            <thead className="text-ink-2">
              <tr>
                {cols.map((k) => (
                  <th key={k} scope="col" className="px-4 py-2 text-start font-normal">
                    {t(`columns.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.provider} className="border-t border-line">
                  <th scope="row" className="px-4 py-2 text-start font-medium">
                    {name(r.provider)}
                  </th>
                  <td className="px-4 py-2">
                    <StatusDot status={MODE_DOT[r.mode]} label={t(`mode.${r.mode}`)} />
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {r.lastWebhookAt ? `${when.format(r.lastWebhookAt)} UTC` : t('never')}
                  </td>
                  <td className="px-4 py-2">
                    {t('webhooksValue', { ok: r.webhooks24h, refused: r.webhooksRejected24h })}
                  </td>
                  <td className="px-4 py-2">
                    {t('sendsValue', { sent: r.sends24h, errors: r.sendErrors24h })}
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {r.errorRateBps === null ? t('noSends') : pct.format(r.errorRateBps / 10_000)}
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {r.lastError
                      ? `${r.lastError}${r.lastErrorAt ? ` · ${when.format(r.lastErrorAt)} UTC` : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </Card>

      {rows
        .filter((r) => r.real)
        .map((r) => (
          <section
            key={r.provider}
            aria-labelledby={`checklist-${r.provider}`}
            className="flex flex-col gap-3"
          >
            <h2 id={`checklist-${r.provider}`} className="text-section">
              {t('checklistTitle', { provider: name(r.provider) })}
            </h2>
            <Card>
              <ol
                className="flex flex-col gap-2 ps-5 text-body"
                aria-label={t('checklistTitle', { provider: name(r.provider) })}
              >
                {r.checklist.map((item) => (
                  <li key={item.id} className="list-decimal">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{t(`items.${item.id}`)}</span>
                      <StatusDot
                        status={item.done === null ? 'info' : item.done ? 'success' : 'warning'}
                        label={item.done === null ? t('ownerStep') : item.done ? t('done') : t('todo')}
                      />
                    </span>
                    {item.check === 'env' && r.missing.length ? (
                      <span className="block font-mono text-caption text-ink-2">
                        {t('missing', { names: r.missing.join(', ') })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </Card>
          </section>
        ))}
    </Shell>
  );
}
