import type { PayLaterRulesDto } from '@yayatoh/registration';
import { Card } from '@yayatoh/ui';
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
      <h2 id="pay-later-heading" className="text-section">
        {t('title')}
      </h2>
      <p className="text-body text-zinc-600">{t('hint')}</p>
      <Link
        href={`/o/${org}/e/${event}/registration/invoices`}
        className="self-start text-body underline underline-offset-2"
      >
        {t('openInvoices')}
      </Link>
      <ul className="flex list-none flex-col gap-3 p-0">
        {types.map((x) => {
          const r = rules.find((y) => y.registrationTypeId === x.id);
          if (!r) return null;
          return (
            <li key={x.id}>
              <Card className="flex flex-col gap-2">
                <p className="text-body font-medium">{x.name}</p>
                <p className="text-caption text-zinc-600">
                  {!r.eligible
                    ? t('summaryNotEligible')
                    : r.payLater
                      ? t('summaryOn', { po: t(`po.${r.poNumber}`) })
                      : t('summaryOff')}
                </p>
                {canWrite && r.eligible ? (
                  <details>
                    <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
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
