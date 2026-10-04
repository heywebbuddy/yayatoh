import { currencyExponent, executeQuery, formatMoney, money } from '@yayatoh/kernel';
import {
  type AllowancesDto,
  LOGO_PLACEMENTS,
  type SponsorPackageDto,
  type SponsorshipAdminDto,
  sponsorshipAdminQuery,
} from '@yayatoh/program';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, StatusPill, Tag } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import {
  assignSessionAction,
  cancelGrantAction,
  grantPackageAction,
  inviteContactAction,
  resendContactAction,
  revokeContactAction,
  savePackageAction,
  setExhibitorAction,
  unassignSessionAction,
} from './actions.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string }> };
type T = Awaited<ReturnType<typeof getTranslations>>;

const decimal = (minor: number, currency: string, locale: string) =>
  formatMoney(money(minor, currency), locale);

/** The allowances of a package or grant, as a definition list. */
function AllowanceList({ a, t }: { a: AllowancesDto; t: T }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-body sm:grid-cols-2">
      {(['compRegistrations', 'exhibitorBadges', 'leadLicenses', 'sessionSlots'] as const).map((k) => (
        <div key={k} className="flex justify-between gap-3 border-b border-line py-1">
          <dt className="text-ink-2">{t(`allowances.${k}`)}</dt>
          <dd className="m-0 font-bold tabular-nums">{a[k]}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-b border-line py-1 sm:col-span-2">
        <dt className="text-ink-2">{t('allowances.logoPlacements')}</dt>
        <dd className="m-0 font-bold">
          {a.logoPlacements.length ? a.logoPlacements.map((p) => t(`placements.${p}`)).join(', ') : t('none')}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Sponsor packages and sponsors (M5.4b): each tier's package terms (price, how many, the bundle of
 * allowances, deliverables every holder gets), and per sponsor its package (granted here or
 * bought in the sponsor portal), the exhibitor it exhibits as, its contacts and session slots.
 * Viewers see it all read-only.
 */
export default async function SponsorPackagesPage({ params }: Params) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, canWrite } = await loadProgramPage(org, event, 'sponsors');
  const admin = await executeQuery(sponsorshipAdminQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('sponsorship');
  const tn = await getTranslations('nav');
  const tp = await getTranslations('program');
  const base = `/o/${org}/e/${event}`;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: base },
              { label: tn('sponsors'), href: `${base}/sponsors` },
              { label: t('packagesTitle') },
            ]}
          />
        }
        title={t('packagesTitle')}
        description={t('packagesSubtitle')}
        actions={
          <Link href={`${base}/sponsors/deliverables`} className={buttonClass('secondary')}>
            {t('deliverablesLink')}
          </Link>
        }
      />
      {canWrite ? null : <Alert tone="info" title={tp('viewerNotice')} />}

      <section aria-labelledby="packages-heading" className="flex flex-col gap-3">
        <h2 id="packages-heading" className="text-section">
          {t('packagesHeading')}
        </h2>
        {admin.packages.length === 0 ? (
          <EmptyState
            title={t('noTiersTitle')}
            description={t('noTiersDescription')}
            action={
              <Link href={`${base}/sponsors`} className="text-body underline">
                {tp('addTier')}
              </Link>
            }
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {admin.packages.map((p) => (
              <li key={p.tierId}>
                <PackageCard
                  p={p}
                  currency={admin.currency}
                  org={org}
                  event={event}
                  canWrite={canWrite}
                  locale={locale}
                  t={t}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sponsor-packages-heading" className="flex flex-col gap-3">
        <h2 id="sponsor-packages-heading" className="text-section">
          {t('sponsorsHeading', { count: admin.sponsors.length })}
        </h2>
        {admin.sponsors.length === 0 ? (
          <EmptyState
            title={t('noSponsorsTitle')}
            description={t('noSponsorsDescription')}
            action={
              <Link href={`${base}/sponsors`} className="text-body underline">
                {tp('addSponsor')}
              </Link>
            }
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {admin.sponsors.map((s) => (
              <li key={s.id}>
                <SponsorCard
                  s={s}
                  admin={admin}
                  org={org}
                  event={event}
                  canWrite={canWrite}
                  locale={locale}
                  t={t}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function PackageCard({
  p,
  currency,
  org,
  event,
  canWrite,
  locale,
  t,
}: {
  p: SponsorPackageDto;
  currency: string;
  org: string;
  event: string;
  canWrite: boolean;
  locale: string;
  t: T;
}) {
  const terms = p.terms;
  const status = !terms
    ? { tone: 'neutral' as const, label: t('status.noTerms') }
    : terms.onSale
      ? p.left === 0
        ? { tone: 'danger' as const, label: t('status.soldOut') }
        : { tone: 'success' as const, label: t('status.onSale') }
      : { tone: 'waiting' as const, label: t('status.notSold') };
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-card">{p.name}</h3>
        <StatusPill tone={status.tone} label={status.label} />
      </div>
      {terms ? (
        <>
          <p className="m-0 text-body tabular-nums">
            {terms.priceMinor !== null ? decimal(terms.priceMinor, terms.currency, locale) : t('noPrice')}
            {' · '}
            {terms.quantity === null
              ? t('holdersUnlimited', { holders: p.holders })
              : t('holdersOf', { holders: p.holders, quantity: terms.quantity, left: p.left ?? 0 })}
          </p>
          {terms.description ? <p className="m-0 text-body text-ink-2">{terms.description}</p> : null}
          <AllowanceList a={terms.allowances} t={t} />
          {terms.deliverables.length ? (
            <p className="m-0 text-caption text-ink-2">
              {t('templatesSummary', { count: terms.deliverables.length })}
            </p>
          ) : null}
        </>
      ) : (
        <p className="m-0 text-body text-ink-2">{t('noTermsDescription')}</p>
      )}
      {canWrite ? (
        <details>
          <summary className="min-h-6 cursor-pointer text-caption text-ink-2">
            {t('editPackage', { name: p.name })}
          </summary>
          <div className="pt-3">
            <ProgramForm
              action={savePackageAction.bind(null, org, event, p.tierId)}
              idPrefix={`package-${p.tierId}`}
              submitLabel={t('savePackage')}
              successLabel={t('packageSaved')}
              errors={{
                price: t('errors.price'),
                price_required: t('errors.priceRequired'),
                quantity: t('errors.quantity'),
                compRegistrations: t('errors.allowance'),
                exhibitorBadges: t('errors.allowance'),
                leadLicenses: t('errors.allowance'),
                sessionSlots: t('errors.slots'),
                deliverables: t('errors.templates'),
                description: t('errors.description'),
              }}
              fields={[
                {
                  kind: 'text',
                  name: 'price',
                  label: t('price', { currency }),
                  hint: t('priceHint'),
                  maxLength: 20,
                  defaultValue:
                    terms?.priceMinor != null
                      ? String(terms.priceMinor / 10 ** currencyExponent(terms.currency))
                      : undefined,
                },
                {
                  kind: 'number',
                  name: 'quantity',
                  label: t('quantity'),
                  hint: t('quantityHint'),
                  defaultValue: terms?.quantity != null ? String(terms.quantity) : undefined,
                },
                {
                  kind: 'checkboxes',
                  name: 'onSale',
                  label: t('selling'),
                  options: [{ value: '1', label: t('onSale') }],
                  defaultValues: terms?.onSale ? ['1'] : [],
                },
                ...(['compRegistrations', 'exhibitorBadges', 'leadLicenses', 'sessionSlots'] as const).map(
                  (k) => ({
                    kind: 'number' as const,
                    name: k,
                    label: t(`allowances.${k}`),
                    min: 0,
                    defaultValue: String(terms?.allowances[k] ?? 0),
                  }),
                ),
                {
                  kind: 'checkboxes',
                  name: 'logoPlacements',
                  label: t('allowances.logoPlacements'),
                  options: LOGO_PLACEMENTS.map((v) => ({ value: v, label: t(`placements.${v}`) })),
                  defaultValues: terms?.allowances.logoPlacements ?? [],
                },
                {
                  kind: 'textarea',
                  name: 'description',
                  label: t('description'),
                  rows: 2,
                  defaultValue: terms?.description,
                },
                {
                  kind: 'textarea',
                  name: 'deliverables',
                  label: t('templates'),
                  hint: t('templatesHint'),
                  rows: 3,
                  defaultValue: terms?.deliverables
                    .map((d) => `${d.title} | ${d.owner} | ${d.daysBefore}`)
                    .join('\n'),
                },
              ]}
            />
          </div>
        </details>
      ) : null}
    </Card>
  );
}

function SponsorCard({
  s,
  admin,
  org,
  event,
  canWrite,
  locale,
  t,
}: {
  s: SponsorshipAdminDto['sponsors'][number];
  admin: SponsorshipAdminDto;
  org: string;
  event: string;
  canWrite: boolean;
  locale: string;
  t: T;
}) {
  const g = s.grant;
  const sellable = admin.packages.filter((p) => p.terms);
  const free = admin.sessions.filter((x) => x.sponsorId === null);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-card">{s.name}</h3>
        <span className="flex flex-wrap items-center gap-2">
          <Tag>{s.tierName}</Tag>
          {g ? (
            <StatusPill tone="success" label={t('grantActive', { name: g.packageName })} />
          ) : s.pendingUntil ? (
            <StatusPill tone="waiting" label={t('grantPending')} />
          ) : (
            <StatusPill tone="neutral" label={t('grantNone')} />
          )}
        </span>
      </div>

      {g ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-caption text-ink-2">
            {g.source === 'purchase'
              ? t('boughtFor', { price: decimal(g.priceMinor, g.currency, locale) })
              : t('grantedByOrganizer')}
            {g.note ? ` · ${g.note}` : ''}
          </p>
          <AllowanceList a={g.allowances} t={t} />
          <p className="m-0 text-body">
            {t('compCode')}{' '}
            {g.compCode ? <span className="font-mono font-bold">{g.compCode}</span> : t('compCodePending')}
          </p>
          {canWrite ? (
            <form action={cancelGrantAction.bind(null, org, event, g.id)}>
              <Button type="submit" variant="ghost" size="sm">
                {t('cancelPackage', { name: s.name })}
              </Button>
            </form>
          ) : null}
        </div>
      ) : canWrite && !s.pendingUntil ? (
        sellable.length ? (
          <ProgramForm
            action={grantPackageAction.bind(null, org, event, s.id)}
            idPrefix={`grant-${s.id}`}
            submitLabel={t('grantPackage')}
            successLabel={t('packageGranted')}
            errors={{
              tierId: t('errors.tier'),
              sold_out: t('errors.soldOut'),
              already_granted: t('errors.alreadyGranted'),
              purchase_pending: t('errors.purchasePending'),
              no_terms: t('errors.noTerms'),
            }}
            fields={[
              {
                kind: 'select',
                name: 'tierId',
                label: t('packageFor', { name: s.name }),
                options: sellable.map((p) => ({ value: p.tierId, label: p.name })),
                defaultValue: sellable.some((p) => p.tierId === s.tierId) ? s.tierId : undefined,
              },
              { kind: 'text', name: 'note', label: t('note'), hint: t('noteHint'), maxLength: 500 },
            ]}
          />
        ) : (
          <p className="m-0 text-body text-ink-2">{t('setTermsFirst')}</p>
        )
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-body font-bold">{t('exhibitsAs')}</h4>
        <p className="m-0 text-body">{s.exhibitorName ?? t('noExhibitor')}</p>
        {canWrite && admin.exhibitors.length ? (
          <ProgramForm
            action={setExhibitorAction.bind(null, org, event, s.id)}
            idPrefix={`exhibitor-${s.id}`}
            submitLabel={t('saveExhibitor')}
            successLabel={t('exhibitorSaved')}
            errors={{ exhibitorId: t('errors.exhibitor'), exhibitor_taken: t('errors.exhibitorTaken') }}
            fields={[
              {
                kind: 'select',
                name: 'exhibitorId',
                label: t('exhibitorFor', { name: s.name }),
                hint: t('exhibitorHint'),
                options: [
                  { value: '', label: t('noExhibitor') },
                  ...admin.exhibitors.map((x) => ({ value: x.id, label: x.name })),
                ],
                defaultValue: s.exhibitorId ?? '',
              },
            ]}
          />
        ) : null}
      </div>

      {g && g.allowances.sessionSlots > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-body font-bold">
            {t('sessionSlots', { used: s.sessions.length, slots: g.allowances.sessionSlots })}
          </h4>
          {s.sessions.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {s.sessions.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body">{x.title}</span>
                  {canWrite ? (
                    <form action={unassignSessionAction.bind(null, org, event, x.id)}>
                      <Button type="submit" variant="ghost" size="sm">
                        {t('removeSession', { title: x.title })}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canWrite && s.sessions.length < g.allowances.sessionSlots && free.length ? (
            <ProgramForm
              action={assignSessionAction.bind(null, org, event, s.id)}
              idPrefix={`session-${s.id}`}
              submitLabel={t('assignSession')}
              successLabel={t('sessionAssigned')}
              errors={{
                sessionId: t('errors.session'),
                slots_used: t('errors.slotsUsed'),
                session_taken: t('errors.sessionTaken'),
                no_slot: t('errors.noSlot'),
              }}
              fields={[
                {
                  kind: 'select',
                  name: 'sessionId',
                  label: t('sessionFor', { name: s.name }),
                  options: free.map((x) => ({ value: x.id, label: x.title })),
                },
              ]}
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-body font-bold">{t('contacts', { count: s.contacts.length })}</h4>
        {s.contacts.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {s.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-body">{c.email}</span>
                  <StatusPill
                    tone={c.status === 'active' ? 'success' : 'waiting'}
                    label={t(`contactStatus.${c.status}`)}
                  />
                </span>
                {canWrite ? (
                  <span className="flex flex-wrap gap-2">
                    <form action={resendContactAction.bind(null, org, event, c.id)}>
                      <Button type="submit" variant="ghost" size="sm">
                        {t('resendTo', { email: c.email })}
                      </Button>
                    </form>
                    <form action={revokeContactAction.bind(null, org, event, c.id)}>
                      <Button type="submit" variant="ghost" size="sm">
                        {t('revokeContact', { email: c.email })}
                      </Button>
                    </form>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-caption text-ink-2">{t('noContacts')}</p>
        )}
        {canWrite ? (
          <details>
            <summary className="min-h-6 cursor-pointer text-caption text-ink-2">
              {t('inviteContactTo', { name: s.name })}
            </summary>
            <div className="pt-3">
              <ProgramForm
                action={inviteContactAction.bind(null, org, event, s.id)}
                idPrefix={`contact-${s.id}`}
                submitLabel={t('sendInvite')}
                successLabel={t('inviteSent')}
                errors={{
                  email: t('errors.email'),
                  already_invited: t('errors.alreadyInvited'),
                  too_many: t('errors.tooManyContacts'),
                  event_over: t('errors.eventOver'),
                }}
                fields={[
                  { kind: 'text', name: 'email', label: t('contactEmail'), required: true, maxLength: 254 },
                ]}
                reset
              />
            </div>
          </details>
        ) : null}
      </div>

      <p className="m-0 text-caption text-ink-2">
        {t('deliverablesSummary', {
          open: s.deliverables.open,
          done: s.deliverables.done,
          overdue: s.deliverables.overdue,
        })}
      </p>
    </Card>
  );
}
