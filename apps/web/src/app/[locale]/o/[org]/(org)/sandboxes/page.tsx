import { executeQuery } from '@yayatoh/kernel';
import { listSandboxesQuery, MAX_SANDBOX_ORGS, roleCan } from '@yayatoh/tenancy';
import { Button, Card, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SandboxForm } from '@/components/sandbox-form.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createSandboxAction, deleteSandboxAction } from './actions.ts';

/**
 * Sandboxes (M6.3a): test orgs linked to this one, with a sample event and fake payments only,
 * never on the marketplace. Create, open and delete them. Owners and admins.
 */
export default async function SandboxesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  if (!roleCan(data.role, 'sandbox:manage')) {
    return (
      <>
        <PageHeader title={t('sandboxes.title')} description={t('sandboxes.subtitle')} />
        <EmptyState title={t('sandboxes.noAccessTitle')} description={t('sandboxes.noAccessDescription')} />
      </>
    );
  }
  if (data.org.sandbox) {
    return (
      <>
        <PageHeader title={t('sandboxes.title')} description={t('sandboxes.subtitle')} />
        <EmptyState
          title={t('sandboxes.sandboxOfSandbox')}
          description={t('sandboxes.inSandboxDescription')}
        />
      </>
    );
  }
  const sandboxes = await executeQuery(listSandboxesQuery, {}, data.ctx, ports);
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  return (
    <>
      <PageHeader title={t('sandboxes.title')} description={t('sandboxes.subtitle')} />
      <Card className="flex flex-col gap-2">
        <h2 className="text-section">{t('sandboxes.factsTitle')}</h2>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-body">
          <li>{t('sandboxes.factPayments')}</li>
          <li>{t('sandboxes.factMarketplace')}</li>
          <li>{t('sandboxes.factData')}</li>
          <li>{t('sandboxes.factKeys')}</li>
        </ul>
      </Card>
      <SandboxForm action={createSandboxAction.bind(null, org)} max={MAX_SANDBOX_ORGS} />
      {sandboxes.length === 0 ? (
        <EmptyState title={t('sandboxes.emptyTitle')} description={t('sandboxes.emptyDescription')} />
      ) : (
        <Table
          caption={t('sandboxes.listTitle')}
          captionHidden={false}
          rowKey={(s) => s.id}
          rows={sandboxes}
          empty={t('sandboxes.emptyTitle')}
          columns={[
            { key: 'name', header: t('sandboxes.name'), cell: (s) => s.name },
            { key: 'slug', header: t('sandboxes.address'), cell: (s) => s.slug, mono: true },
            {
              key: 'created',
              header: t('sandboxes.createdAt'),
              cell: (s) =>
                formatDate(s.createdAt.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' }),
              mono: true,
            },
            {
              key: 'actions',
              header: t('sandboxes.actions'),
              align: 'end',
              cell: (s) => (
                <div className="flex flex-wrap items-start justify-end gap-2">
                  <Link
                    href={`/o/${s.slug}`}
                    className="inline-flex min-h-8 items-center rounded-pill border border-zinc-200 bg-white px-3 text-caption font-medium"
                    aria-label={t('sandboxes.open', { name: s.name })}
                  >
                    {t('sandboxes.openShort')}
                  </Link>
                  <details className="text-start">
                    <summary className="inline-flex min-h-8 cursor-pointer list-none items-center rounded-pill border border-zinc-200 bg-white px-3 text-caption font-medium [&::-webkit-details-marker]:hidden">
                      <span aria-hidden="true">{t('sandboxes.delete')}</span>
                      <span className="sr-only">{t('sandboxes.deleteNamed', { name: s.name })}</span>
                    </summary>
                    <StepUpForm
                      action={deleteSandboxAction.bind(null, org, s.id)}
                      className="mt-2 flex min-w-[220px] flex-col gap-2"
                    >
                      <p className="text-caption text-zinc-600">{t('sandboxes.deleteWarning')}</p>
                      <div>
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          aria-label={t('sandboxes.deleteConfirmNamed', { name: s.name })}
                        >
                          {t('sandboxes.deleteConfirm')}
                        </Button>
                      </div>
                    </StepUpForm>
                  </details>
                </div>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
