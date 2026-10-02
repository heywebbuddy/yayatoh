import { executeQuery } from '@yayatoh/kernel';
import { MERGE_FIELDS, supportMacrosQuery } from '@yayatoh/orders';
import { roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ConfirmButton, MacroEditor } from '@/components/support-tools.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { archiveMacroAction, saveMacroAction } from './actions.ts';

/**
 * Support macros (M3.10c): saved replies and the actions that go with them (email the buyer, add
 * a team note, resend the tickets, transfer a ticket), run from an order's page. Merge fields fill
 * in the order's details. Buyer support roles (`orders:support`).
 */
export default async function MacrosPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('ticketing') || !roleCan(data.role, 'orders:support')) notFound();
  const t = await getTranslations('supportTools.macros');
  const macros = await executeQuery(supportMacrosQuery, {}, data.ctx, ports);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <section aria-labelledby="macro-new-heading" className="flex flex-col gap-3">
        <h2 id="macro-new-heading" className="text-section">
          {t('newTitle')}
        </h2>
        <Card>
          <MacroEditor
            action={saveMacroAction.bind(null, org, null)}
            fields={MERGE_FIELDS}
            idPrefix="macro-new"
          />
        </Card>
      </section>
      <section aria-labelledby="macro-list-heading" className="flex flex-col gap-3">
        <h2 id="macro-list-heading" className="text-section">
          {t('listTitle')}
        </h2>
        {macros.length === 0 ? (
          <EmptyState title={t('noneTitle')} description={t('noneDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-4 p-0">
            {macros.map((m) => (
              <li key={m.id}>
                <Card className="flex flex-col gap-3">
                  <details>
                    <summary className="flex min-h-6 cursor-pointer items-center gap-2 text-section">
                      {m.name}
                      <span className="text-caption text-zinc-500">
                        {m.actions.map((a) => t(`action.${a}`)).join(' · ')}
                      </span>
                    </summary>
                    <div className="mt-3">
                      <MacroEditor
                        action={saveMacroAction.bind(null, org, m.id)}
                        macro={m}
                        fields={MERGE_FIELDS}
                        idPrefix={`macro-${m.id}`}
                      />
                    </div>
                  </details>
                  <ConfirmButton
                    action={archiveMacroAction.bind(null, org, m.id)}
                    label={t('archive', { name: m.name })}
                    done={t('archived')}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
