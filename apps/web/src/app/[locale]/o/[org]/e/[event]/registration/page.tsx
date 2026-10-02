import { currencyExponent, executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { isProfileKey, navIncludes } from '@yayatoh/platform';
import {
  type AdmissionItemDto,
  type RegistrationTypeDto,
  registrationSetupQuery,
} from '@yayatoh/registration';
import { roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { RegistrationCell } from '@/components/registration-cell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  archiveItemAction,
  archiveTypeAction,
  createItemAction,
  createTypeAction,
  disableCellAction,
  seedDefaultsAction,
  setCellAction,
  updateItemAction,
  updateTypeAction,
} from './actions.ts';

const decimal = (minor: number, currency: string) => {
  const exp = currencyExponent(currency);
  return exp === 0 ? String(minor) : (minor / 10 ** exp).toFixed(exp);
};

/**
 * Registration (M5.1a): registration types (who), admission items (what is bought), and the type ×
 * item matrix of prices, each cell a pass sold only through registration. Per-type capacity and
 * eligibility (access code or email domain) live on the type. Everything works by keyboard; viewers
 * see the page read-only.
 */
export default async function RegistrationPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!navIncludes(profile, data.modules, 'registration')) notFound();
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, data.ctx, ports);
  const canWrite = roleCan(data.role, 'events:write');
  const t = await getTranslations('registration');
  const tv = await getTranslations('vocab');
  const tf = await getTranslations('registrationForm');
  const errors: Record<string, string> = {
    name: t('errors.name'),
    'conflict.key': t('errors.keyTaken'),
    capacity: t('errors.capacity'),
    capacity_below_taken: t('errors.capacity_below_taken'),
    accessCode: t('errors.accessCode'),
    emailDomains: t('errors.emailDomains'),
    kind: t('errors.kind'),
    kind_locked: t('errors.kind_locked'),
    quota_reached: t('errors.quota_reached'),
    event_finished: t('errors.event_finished'),
    sortOrder: t('errors.sortOrder'),
  };
  const eligibilityOptions = [
    { value: 'open', label: t('eligibility.open') },
    { value: 'access_code', label: t('eligibility.access_code') },
    { value: 'email_domain', label: t('eligibility.email_domain') },
  ];
  const typeFields = (x?: RegistrationTypeDto): FieldSpec[] => [
    {
      kind: 'text',
      name: 'name',
      label: t('typeName'),
      required: true,
      maxLength: 80,
      defaultValue: x?.name,
    },
    {
      kind: 'textarea',
      name: 'description',
      label: t('description'),
      rows: 2,
      defaultValue: x?.description ?? '',
    },
    {
      kind: 'number',
      name: 'capacity',
      label: t('capacity'),
      hint: t('capacityHint'),
      defaultValue: x?.capacity === null || x === undefined ? undefined : String(x.capacity),
    },
    {
      kind: 'select',
      name: 'eligibility',
      label: t('whoMayRegister'),
      options: eligibilityOptions,
      defaultValue: x?.eligibility ?? 'open',
    },
    {
      kind: 'text',
      name: 'accessCode',
      label: t('accessCode'),
      hint: t('accessCodeHint'),
      maxLength: 32,
      defaultValue: x?.accessCode ?? undefined,
    },
    {
      kind: 'textarea',
      name: 'emailDomains',
      label: t('emailDomains'),
      hint: t('emailDomainsHint'),
      rows: 2,
      defaultValue: x?.emailDomains.join('\n') ?? '',
    },
    {
      kind: 'number',
      name: 'sortOrder',
      label: t('order'),
      defaultValue: x ? String(x.sortOrder) : undefined,
    },
  ];
  const kindOptions = [
    { value: 'admission', label: t('kind.admission') },
    { value: 'add_on', label: t('kind.add_on') },
  ];
  const itemFields = (x?: AdmissionItemDto): FieldSpec[] => [
    {
      kind: 'text',
      name: 'name',
      label: t('itemName'),
      required: true,
      maxLength: 80,
      defaultValue: x?.name,
    },
    {
      kind: 'select',
      name: 'kind',
      label: t('itemKind'),
      hint: t('itemKindHint'),
      options: kindOptions,
      defaultValue: x?.kind ?? 'admission',
    },
    {
      kind: 'textarea',
      name: 'description',
      label: t('description'),
      rows: 2,
      defaultValue: x?.description ?? '',
    },
    {
      kind: 'number',
      name: 'sortOrder',
      label: t('order'),
      defaultValue: x ? String(x.sortOrder) : undefined,
    },
  ];
  const eligibilitySummary = (x: RegistrationTypeDto) =>
    x.eligibility === 'access_code'
      ? t('eligibilitySummary.access_code')
      : x.eligibility === 'email_domain'
        ? t('eligibilitySummary.email_domain', { domains: x.emailDomains.join(', ') })
        : t('eligibilitySummary.open');
  const cellOf = (typeId: string, itemId: string) =>
    setup.cells.find((c) => c.registrationTypeId === typeId && c.admissionItemId === itemId);
  const empty = setup.types.length === 0 && setup.items.length === 0;
  return (
    <>
      <PageHeader title={tv('registration')} description={t('subtitle')} />
      {/* M5.1b: the multi-page registration form for this event's types. */}
      <Link
        href={`/o/${org}/e/${event}/registration-form`}
        className="self-start text-body underline underline-offset-2"
      >
        {tf('openBuilder')}
      </Link>
      {canWrite ? null : <p className="text-body text-ink-2">{t('viewerNotice')}</p>}
      <p className="text-caption text-ink-2">
        {setup.pack.active
          ? t('packActive', { registrants: setup.pack.quotas.registrants ?? 0 })
          : t('packInactive')}
      </p>
      {empty ? (
        <Card className="flex flex-col gap-3">
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
          {canWrite ? (
            <ProgramForm
              action={seedDefaultsAction.bind(null, org, event)}
              fields={[]}
              idPrefix="seed"
              submitLabel={t('seedDefaults')}
              successLabel={t('seeded')}
              errors={errors}
            />
          ) : null}
        </Card>
      ) : null}

      <section aria-labelledby="types-heading" className="flex flex-col gap-3">
        <h2 id="types-heading" className="text-section">
          {t('types')}
        </h2>
        {setup.types.length === 0 ? (
          <p className="text-body text-ink-2">{t('noTypes')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {setup.types.map((x) => (
              <li key={x.id}>
                <Card className="flex flex-col gap-2">
                  <h3 className="text-body font-medium">{x.name}</h3>
                  <p className="text-caption text-ink-2">{eligibilitySummary(x)}</p>
                  <p className="text-caption text-ink-2">
                    {x.capacity === null
                      ? t('takenUnlimited', { taken: x.quantityHeld + x.quantitySold })
                      : t('taken', { taken: x.quantityHeld + x.quantitySold, capacity: x.capacity })}
                    {x.waiting + x.offered > 0
                      ? ` · ${t('waitlistCounts', { waiting: x.waiting, offered: x.offered })}`
                      : ''}
                  </p>
                  {canWrite ? (
                    <details>
                      <summary className="min-h-6 cursor-pointer text-caption text-ink-2">
                        {t('editNamed', { name: x.name })}
                      </summary>
                      <div className="flex flex-col gap-3 pt-3">
                        <ProgramForm
                          action={updateTypeAction.bind(null, org, event, x.id)}
                          fields={typeFields(x)}
                          idPrefix={`type-${x.id}`}
                          submitLabel={t('save')}
                          successLabel={t('saved')}
                          errors={errors}
                        />
                        <ProgramForm
                          action={archiveTypeAction.bind(null, org, event, x.id)}
                          fields={[]}
                          idPrefix={`archive-type-${x.id}`}
                          submitLabel={t('archiveNamed', { name: x.name })}
                          successLabel={t('archived')}
                          errors={errors}
                        />
                      </div>
                    </details>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <section aria-labelledby="add-type-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="add-type-heading" className="text-section">
                {t('addType')}
              </h3>
              <ProgramForm
                action={createTypeAction.bind(null, org, event)}
                fields={typeFields()}
                idPrefix="new-type"
                submitLabel={t('addType')}
                successLabel={t('typeAdded')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        ) : null}
      </section>

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <h2 id="items-heading" className="text-section">
          {t('items')}
        </h2>
        {setup.items.length === 0 ? (
          <p className="text-body text-ink-2">{t('noItems')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {setup.items.map((x) => (
              <li key={x.id}>
                <Card className="flex flex-col gap-2">
                  <h3 className="text-body font-medium">{x.name}</h3>
                  <p className="text-caption text-ink-2">{t(`kind.${x.kind}`)}</p>
                  {canWrite ? (
                    <details>
                      <summary className="min-h-6 cursor-pointer text-caption text-ink-2">
                        {t('editNamed', { name: x.name })}
                      </summary>
                      <div className="flex flex-col gap-3 pt-3">
                        <ProgramForm
                          action={updateItemAction.bind(null, org, event, x.id)}
                          fields={itemFields(x)}
                          idPrefix={`item-${x.id}`}
                          submitLabel={t('save')}
                          successLabel={t('saved')}
                          errors={errors}
                        />
                        <ProgramForm
                          action={archiveItemAction.bind(null, org, event, x.id)}
                          fields={[]}
                          idPrefix={`archive-item-${x.id}`}
                          submitLabel={t('archiveNamed', { name: x.name })}
                          successLabel={t('archived')}
                          errors={errors}
                        />
                      </div>
                    </details>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <section aria-labelledby="add-item-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="add-item-heading" className="text-section">
                {t('addItem')}
              </h3>
              <ProgramForm
                action={createItemAction.bind(null, org, event)}
                fields={itemFields()}
                idPrefix="new-item"
                submitLabel={t('addItem')}
                successLabel={t('itemAdded')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        ) : null}
      </section>

      {setup.types.length > 0 && setup.items.length > 0 ? (
        <section aria-labelledby="matrix-heading" className="flex flex-col gap-3">
          <h2 id="matrix-heading" className="text-section">
            {t('matrix')}
          </h2>
          <p className="text-body text-ink-2">{t('matrixHint')}</p>
          <section
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (axe scrollable-region-focusable)
            tabIndex={0}
            aria-label={t('matrixCaption')}
            // `relative`: absolutely positioned sr-only labels are clipped by the scroller too.
            className="relative overflow-x-auto rounded-card border border-line bg-surface"
          >
            <table className="w-full border-collapse text-start">
              <caption className="sr-only">{t('matrixCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-3 text-start text-caption text-ink-2">
                    {t('typeColumn')}
                  </th>
                  {setup.items.map((i) => (
                    <th key={i.id} scope="col" className="p-3 text-start text-caption text-ink-2">
                      {i.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {setup.types.map((x) => (
                  <tr key={x.id} className="border-t border-line align-top">
                    <th scope="row" className="p-3 text-start text-body font-medium">
                      {x.name}
                    </th>
                    {setup.items.map((i) => {
                      const cell = cellOf(x.id, i.id);
                      return (
                        <td key={i.id} className="p-3">
                          <RegistrationCell
                            label={`${x.name} · ${i.name}`}
                            currency={setup.currency}
                            price={cell ? decimal(cell.priceMinor, setup.currency) : null}
                            canWrite={canWrite}
                            setAction={setCellAction.bind(null, org, event, x.id, i.id)}
                            disableAction={disableCellAction.bind(null, org, event, x.id, i.id)}
                          />
                          {cell ? (
                            <p className="pt-1 text-caption text-ink-2">
                              {t('cellSold', {
                                count: cell.quantitySold,
                                allIn: formatMoney(money(cell.allInMinor, setup.currency), locale),
                              })}
                            </p>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </section>
      ) : null}
    </>
  );
}
