import { formatMoney, executeQuery, isDomainError, money } from '@yayatoh/kernel';
import { isProfileKey, PROFILES } from '@yayatoh/platform';
import { getTemplateQuery } from '@yayatoh/templates';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Breadcrumb, Button, buttonClass, Card, Label, PageHeader, Stepper } from '@yayatoh/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CopyEventForm } from '@/components/copy-forms.tsx';
import { SectionForm } from '@/components/section-form.tsx';
import { ChecklistItemForm, TemplateSettingsForm, TemplateTicketForm } from '@/components/template-builder.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createFromTemplateAction, duplicateTemplateAction, setTemplateArchivedAction } from '../actions.ts';
import {
  addChecklistItemAction,
  addSectionAction,
  addTicketTypeAction,
  moveSectionAction,
  removeChecklistItemAction,
  removeSectionAction,
  removeTicketTypeAction,
  updateTemplateAction,
} from './actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Profiles whose events sell tickets or take registrations (a wedding has guests instead). */
const sellsTickets = (profile: string) =>
  isProfileKey(profile) && PROFILES[profile].nav.some((i) => i.key === 'ticketsOrders');

/**
 * U6: one template, built step by step (kind of event → ticket types → page sections → page
 * content → checklist), with the events made from it and a form to create the next one.
 */
export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; template: string }>;
  searchParams: Promise<{ created?: string; copied?: string; duplicated?: string }>;
}) {
  const { locale, org, template } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!UUID.test(template)) notFound();
  const tpl = await executeQuery(getTemplateQuery, { templateId: template }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const t = await getTranslations();
  const tb = await getTranslations('templateBuilder');
  const canWrite = roleCan(data.role, 'events:write');
  const archived = tpl.archivedAt !== null;
  const editable = canWrite && !archived;
  const tickets = sellsTickets(tpl.profile);
  const priced = new Set(tpl.seatingKeys);
  const hours = Math.floor(tpl.durationMinutes / 60);
  const minutes = tpl.durationMinutes % 60;
  const duration = [
    hours ? tb('durationHours', { hours }) : null,
    minutes ? tb('durationMinutes', { minutes }) : null,
  ]
    .filter(Boolean)
    .join(' ');
  const steps = [
    { key: 'profile', done: true, href: '#profile' },
    ...(tickets ? [{ key: 'tickets', done: tpl.ticketTypes > 0, href: '#tickets' }] : []),
    { key: 'sections', done: tpl.sections > 0, href: '#sections' },
    { key: 'content', done: Boolean(tpl.tagline || tpl.venueName), href: '#content' },
    { key: 'checklist', done: tpl.checklist > 0, href: '#checklist' },
  ] as const;
  const firstTodo = steps.find((s) => !s.done)?.key;
  const notice = sp.created ? tb('created') : sp.copied ? tb('copied') : sp.duplicated ? tb('duplicated') : null;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            label={tb('breadcrumb')}
            link={Link}
            items={[{ label: t('templates.title'), href: `/o/${org}/templates` }, { label: tpl.name }]}
          />
        }
        eyebrow={t(`profiles.${tpl.profile as 'other'}`)}
        title={tpl.name}
        description={tpl.description ?? undefined}
        meta={
          <span className="text-caption text-ink-2">
            {tpl.origin === 'event' ? t('templates.originEvent') : t('templates.originScratch')} · {duration}
          </span>
        }
        actions={
          canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              {archived ? (
                <form action={setTemplateArchivedAction.bind(null, org, tpl.id, false)}>
                  <Button type="submit" aria-label={t('templates.restoreFor', { name: tpl.name })}>
                    {t('templates.restore')}
                  </Button>
                </form>
              ) : (
                <a href="#use" className={buttonClass('primary', 'md')}>
                  {tb('useAction')}
                </a>
              )}
              <form action={duplicateTemplateAction.bind(null, org, tpl.id, tpl.name)}>
                <Button
                  type="submit"
                  variant="secondary"
                  aria-label={t('templates.duplicateFor', { name: tpl.name })}
                >
                  {t('templates.duplicate')}
                </Button>
              </form>
              {archived ? null : (
                <form action={setTemplateArchivedAction.bind(null, org, tpl.id, true)}>
                  <Button type="submit" variant="ghost" aria-label={t('templates.archiveFor', { name: tpl.name })}>
                    {t('templates.archive')}
                  </Button>
                </form>
              )}
            </div>
          ) : undefined
        }
      />
      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {notice ? <Alert tone="success" title={notice} /> : null}
        {archived ? <Alert tone="warning" title={tb('archivedNotice')} /> : null}
      </div>
      <Stepper
        label={tb('steps')}
        steps={steps.map((s) => ({
          label: tb(`step.${s.key}`),
          state: s.key === firstTodo ? 'current' : s.done ? 'done' : 'todo',
          href: s.href,
        }))}
      />

      <section id="profile" aria-labelledby="profile-heading" className="flex scroll-mt-4 flex-col gap-3">
        <h2 id="profile-heading" className="text-section">
          {tb('profileTitle')}
        </h2>
        <Card className="flex flex-col gap-1">
          <p className="text-body font-bold">{t(`profiles.${tpl.profile as 'other'}`)}</p>
          <p className="text-body text-ink-2">{tb(`profileHelp.${tpl.profile as 'other'}`)}</p>
          <p className="text-caption text-ink-2">{tb('profileFixed')}</p>
        </Card>
      </section>

      {tickets ? (
        <section id="tickets" aria-labelledby="tickets-heading" className="flex scroll-mt-4 flex-col gap-3">
          <h2 id="tickets-heading" className="text-section">
            {tb('ticketsTitle')}
          </h2>
          <p className="text-body text-ink-2">{tb('ticketsHint')}</p>
          <Card className="flex flex-col gap-4">
            {tpl.ticketTypeList.length === 0 ? (
              <p className="text-body text-ink-2">{tb('ticketsEmpty')}</p>
            ) : (
              <ul aria-label={tb('ticketsList')} className="m-0 flex list-none flex-col gap-2 p-0">
                {tpl.ticketTypeList.map((tt) => (
                  <li
                    key={tt.key}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line px-4 py-3"
                  >
                    <span className="flex flex-col">
                      <span className="text-body font-semibold">{tt.name}</span>
                      {tt.description ? <span className="text-caption text-ink-2">{tt.description}</span> : null}
                      <span className="text-caption text-ink-2">
                        {tb('ticketLine', {
                          price:
                            tt.priceMinor === 0
                              ? tb('free')
                              : formatMoney(money(tt.priceMinor, tpl.currency), locale),
                          quantity: tt.quantityTotal,
                        })}
                      </span>
                    </span>
                    {editable ? (
                      priced.has(tt.key) ? (
                        <Label>{tb('seatPriced')}</Label>
                      ) : (
                        <form action={removeTicketTypeAction.bind(null, org, tpl.id, tt.key)}>
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={tb('removeTicket', { name: tt.name })}
                          >
                            {t('templates.delete')}
                          </Button>
                        </form>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {editable ? (
              <TemplateTicketForm
                action={addTicketTypeAction.bind(null, org, tpl.id, tpl.currency)}
                currency={tpl.currency}
              />
            ) : null}
          </Card>
        </section>
      ) : null}

      <section id="sections" aria-labelledby="sections-heading" className="flex scroll-mt-4 flex-col gap-3">
        <h2 id="sections-heading" className="text-section">
          {tb('sectionsTitle')}
        </h2>
        <p className="text-body text-ink-2">{tb('sectionsHint')}</p>
        <Card className="flex flex-col gap-4">
          {tpl.sectionList.length === 0 ? (
            <p className="text-body text-ink-2">{tb('sectionsEmpty')}</p>
          ) : (
            <ol aria-label={tb('sectionsList')} className="m-0 flex list-none flex-col gap-2 p-0">
              {tpl.sectionList.map((s, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: a snapshot's sections have no ids; the order is the identity
                  key={`${i}-${s.title}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line px-4 py-3"
                >
                  <span className="flex flex-col">
                    <span className="text-body font-semibold">{s.title}</span>
                    <span className="text-caption text-ink-2">{t(`content.kinds.${s.kind}`)}</span>
                  </span>
                  {editable ? (
                    <span className="flex items-center gap-1">
                      <form action={moveSectionAction.bind(null, org, tpl.id, i, 'up')}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={i === 0}
                          aria-label={tb('moveUp', { title: s.title })}
                        >
                          <ArrowUp className="size-4" aria-hidden="true" />
                        </Button>
                      </form>
                      <form action={moveSectionAction.bind(null, org, tpl.id, i, 'down')}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={i === tpl.sectionList.length - 1}
                          aria-label={tb('moveDown', { title: s.title })}
                        >
                          <ArrowDown className="size-4" aria-hidden="true" />
                        </Button>
                      </form>
                      <form action={removeSectionAction.bind(null, org, tpl.id, i)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={tb('removeSection', { title: s.title })}
                        >
                          {t('templates.delete')}
                        </Button>
                      </form>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {editable ? (
            <section aria-labelledby="add-section-heading" className="flex flex-col gap-3">
              <h3 id="add-section-heading" className="text-body font-bold">
                {tb('addSection')}
              </h3>
              <SectionForm action={addSectionAction.bind(null, org, tpl.id)} idPrefix="tpl-section" />
            </section>
          ) : null}
        </Card>
      </section>

      <Card size="panel">
        <TemplateSettingsForm
          action={updateTemplateAction.bind(null, org, tpl.id)}
          disabled={!editable}
          visibilities={(['public', 'unlisted', 'private'] as const).map((v) => ({
            value: v,
            label: t(`details.visibilities.${v}`),
            text: t(`details.visibilities.${v}`),
          }))}
          values={{
            name: tpl.name,
            description: tpl.description,
            visibility: tpl.visibility,
            timezone: tpl.timezone,
            currency: tpl.currency,
            durationMinutes: tpl.durationMinutes,
            tagline: tpl.tagline,
            venueName: tpl.venueName,
            city: tpl.city,
          }}
        />
      </Card>

      <section id="checklist" aria-labelledby="checklist-heading" className="flex scroll-mt-4 flex-col gap-3">
        <h2 id="checklist-heading" className="text-section">
          {tb('checklistTitle')}
        </h2>
        <p className="text-body text-ink-2">{tb('checklistHint')}</p>
        <Card className="flex flex-col gap-4">
          {tpl.checklistItems.length === 0 ? (
            <p className="text-body text-ink-2">{tb('checklistEmpty')}</p>
          ) : (
            <ol aria-label={tb('checklistList')} className="m-0 flex list-none flex-col gap-2 p-0">
              {tpl.checklistItems.map((item, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: titles may repeat; the order is the identity
                  key={`${i}-${item}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line px-4 py-3"
                >
                  <span className="text-body">{item}</span>
                  {editable ? (
                    <form action={removeChecklistItemAction.bind(null, org, tpl.id, i)}>
                      <Button type="submit" variant="ghost" size="sm" aria-label={tb('removeItem', { title: item })}>
                        {t('templates.delete')}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {editable ? (
            <ChecklistItemForm
              action={addChecklistItemAction.bind(null, org, tpl.id)}
              idPrefix="tpl-checklist"
              labels={{
                field: tb('checklistItem'),
                submit: tb('addItem'),
                added: tb('itemAdded'),
                invalid: tb('itemInvalid'),
                tooMany: tb('tooMany'),
              }}
            />
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="events-heading" className="flex flex-col gap-3">
        <h2 id="events-heading" className="text-section">
          {tb('eventsTitle')}
        </h2>
        <Card>
          {tpl.events.length === 0 ? (
            <p className="text-body text-ink-2">{tb('eventsEmpty')}</p>
          ) : (
            <ul aria-label={tb('eventsList')} className="m-0 flex list-none flex-col gap-2 p-0">
              {tpl.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3">
                  <Link href={`/o/${org}/e/${e.slug}`} className="inline-flex min-h-6 items-center underline">
                    {e.name}
                  </Link>
                  <span className="text-caption text-ink-2">{t(`eventStatus.${e.status as 'draft'}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {editable ? (
        <section id="use" aria-labelledby="use-heading" className="flex scroll-mt-4 flex-col gap-3">
          <h2 id="use-heading" className="text-section">
            {tb('useTitle')}
          </h2>
          <p className="text-body text-ink-2">{tb('useHint')}</p>
          <Card>
            <CopyEventForm
              idPrefix="use"
              action={createFromTemplateAction.bind(null, org, tpl.id, tpl.timezone)}
              defaults={{ name: '', startsAt: '' }}
              submitLabel={t('templates.createEvent')}
              timeZone={tpl.timezone}
            />
          </Card>
        </section>
      ) : null}
    </>
  );
}
