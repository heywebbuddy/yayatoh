import { creditBalanceQuery, listBrandKitsQuery } from '@yayatoh/ai';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Badge, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BrandKitForm } from '@/components/brand-kit-form.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { deleteBrandKitAction, saveBrandKitAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('brandKits');
  return { title: t('title') };
}

/**
 * M6.12b: brand kits — the voices AI drafts follow (campaigns, pages, agendas): a description of
 * the voice, a default tone, words to prefer and to avoid. Writers manage them; others read.
 */
export default async function BrandKitsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('ai') || !roleCan(data.role, 'marketing:read')) notFound();
  const t = await getTranslations('brandKits');
  const ta = await getTranslations('aiCompose');
  const canWrite = roleCan(data.role, 'marketing:write');
  const kits = await executeQuery(listBrandKitsQuery, {}, data.ctx, ports);
  const credits = roleCan(data.role, 'events:read')
    ? await executeQuery(creditBalanceQuery, {}, data.ctx, ports)
    : null;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {credits ? (
        <p className="text-body text-ink-2" data-testid="ai-credits">
          {ta('credits', { balance: credits.balance, allowance: credits.allowance })}
        </p>
      ) : null}
      {!canWrite ? <p className="text-body text-ink-2">{t('readOnly')}</p> : null}
      {kits.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={canWrite ? t('emptyDescription') : t('emptyViewer')}
          action={
            canWrite ? (
              <a href="#new-brand-kit" className="underline underline-offset-2">
                {t('emptyAction')}
              </a>
            ) : undefined
          }
        />
      ) : (
        <section aria-labelledby="kits-heading" className="flex flex-col gap-3">
          <h2 id="kits-heading" className="text-section">
            {t('listTitle', { count: kits.length })}
          </h2>
          <ul className="flex list-none flex-col gap-3 p-0">
            {kits.map((k) => (
              <li key={k.id}>
                <Card>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-body font-bold">{k.name}</h3>
                      {k.isDefault ? <Badge tone="primary">{t('default')}</Badge> : null}
                      <span className="text-caption text-ink-2">{ta(`tones.${k.tone}`)}</span>
                    </div>
                    {k.voice ? <p className="text-body">{k.voice}</p> : null}
                    {k.keywords.length ? (
                      <p className="text-caption">{t('keywordsShown', { words: k.keywords.join(', ') })}</p>
                    ) : null}
                    {k.avoid.length ? (
                      <p className="text-caption">{t('avoidShown', { words: k.avoid.join(', ') })}</p>
                    ) : null}
                    {canWrite ? (
                      <details>
                        <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-2">
                          {t('edit', { name: k.name })}
                        </summary>
                        <BrandKitForm
                          idPrefix={`kit-${k.id.slice(-8)}`}
                          kit={k}
                          save={saveBrandKitAction.bind(null, org, k.id)}
                          remove={deleteBrandKitAction.bind(null, org, k.id)}
                        />
                      </details>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canWrite ? (
        <Card>
          <section aria-labelledby="new-brand-kit" className="flex flex-col gap-3">
            <h2 id="new-brand-kit" className="text-section">
              {t('newTitle')}
            </h2>
            <BrandKitForm idPrefix="kit-new" kit={null} save={saveBrandKitAction.bind(null, org, null)} />
          </section>
        </Card>
      ) : null}
    </>
  );
}
