import type { PayLaterRulesDto } from '@yayatoh/registration';
import { buttonClass, Card, SectionHeader, StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { setPayLaterAction } from './actions.ts';

/**
 * Pay later by invoice per type (M5.1d, P5-5): whether buyers of a type may register now and pay
 * by invoice (Net 30, due no later than 7 days before the event), and whether a PO number is asked
 * for or required. Approval and +1 types are paid another way. Viewers see the summary only.
 */
export async function PayLaterRules({
  org,
  event,
  types,
  rules,
  canWrite,
}: {
  org: string;
  event: string;
  types: readonly { id: string; name: string }[];
  rules: readonly PayLaterRulesDto[];
  canWrite: boolean;
}) {
  const t = await getTranslations('registration.payLater');
  const errors: Record<string, string> = {
    approval_type: t('errors.approval_type'),
    guest_type: t('errors.guest_type'),
    event_finished: t('errors.event_finished'),
  };
  return (
    <section aria-labelledby="pay-later-heading" className="flex flex-col gap-3">
      <SectionHeader
        id="pay-later-heading"
        title={t('title')}
        description={t('hint')}
        actions={
          <Link
            href={`/o/${org}/e/${event}/registration/invoices`}
            className={buttonClass('secondary', 'sm')}
          >
            {t('openInvoices')}
          </Link>
        }
      />
      <ul className="flex list-none flex-col gap-3 p-0">
        {types.map((x) => {
          const r = rules.find((y) => y.registrationTypeId === x.id);
          if (!r) return null;
          return (
            <li key={x.id}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-body font-bold text-ink">{x.name}</p>
                  {r.eligible ? (
                    <StatusPill
                      tone={r.payLater ? 'success' : 'neutral'}
                      label={r.payLater ? t('on') : t('off')}
                    />
                  ) : null}
                </div>
                <p className="m-0 text-caption text-ink-2">
                  {!r.eligible
                    ? t('summaryNotEligible')
                    : r.payLater
                      ? t('summaryOn', { po: t(`po.${r.poNumber}`) })
                      : t('summaryOff')}
                </p>
                {canWrite && r.eligible ? (
                  <details className="border-t border-line pt-2">
                    <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-[10px] px-2 text-caption font-bold text-primary-ink hover:bg-surface-3">
                      {t('editNamed', { name: x.name })}
                    </summary>
                    <div className="pt-3">
                      <ProgramForm
                        action={setPayLaterAction.bind(null, org, event, x.id)}
                        fields={[
                          {
                            kind: 'select',
                            name: 'payLater',
                            label: t('payLater'),
                            options: [
                              { value: 'off', label: t('off') },
                              { value: 'on', label: t('on') },
                            ],
                            defaultValue: r.payLater ? 'on' : 'off',
                          },
                          {
                            kind: 'select',
                            name: 'poNumber',
                            label: t('poNumber'),
                            hint: t('poNumberHint'),
                            options: (['off', 'optional', 'required'] as const).map((v) => ({
                              value: v,
                              label: t(`po.${v}`),
                            })),
                            defaultValue: r.poNumber,
                          },
                        ]}
                        idPrefix={`pay-later-${x.id}`}
                        submitLabel={t('save')}
                        successLabel={t('saved')}
                        errors={errors}
                      />
                    </div>
                  </details>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
