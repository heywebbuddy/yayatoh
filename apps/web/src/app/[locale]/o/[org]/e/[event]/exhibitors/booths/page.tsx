import { boothSize } from '@yayatoh/floorplan';
import { executeQuery } from '@yayatoh/kernel';
import { type BoothDto, boothPlanQuery } from '@yayatoh/program';
import { Button, Card, Chip, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BoothDragAssign } from '@/components/booth-drag-assign.tsx';
import { BoothMap } from '@/components/booth-map.tsx';
import { type FieldSpec, ProgramForm, ScheduleWarning } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { boothWarningMessages } from '@/server/booths.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import {
  assignBoothAction,
  deleteBoothAction,
  dropAssignAction,
  makePrimaryAction,
  saveBoothAction,
  unassignBoothAction,
} from './actions.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string }> };

const metres = (cm: number) => String(cm / 100);

/**
 * Booths on the floor plan (M5.4a): booth objects with a number, size and category, drawn as the
 * exhibit hall, and exhibitors assigned to them (co-exhibitors allowed, one primary). Every action
 * is a form or button in the list, so the plan works by keyboard; dragging an exhibitor onto a
 * booth on the map is a shortcut for the same assignment. Conflicts are warnings.
 */
export default async function BoothsPage({ params }: Params) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, program, canWrite } = await loadProgramPage(org, event, 'exhibitors');
  const plan = await executeQuery(boothPlanQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('booths');
  const tp = await getTranslations('program');
  const nameOf = (id: string) => program.exhibitors.find((x) => x.id === id)?.name ?? '—';
  const warnings = await boothWarningMessages(plan, nameOf);
  const base = `/o/${org}/e/${event}`;
  const errors = {
    number: t('errors.number'),
    taken: t('errors.taken'),
    category: t('errors.category'),
    width: t('errors.size'),
    height: t('errors.size'),
    x: t('errors.position'),
    y: t('errors.position'),
    too_many: tp('errors.too_many'),
  };
  const fields = (b?: BoothDto): FieldSpec[] => [
    {
      kind: 'text',
      name: 'number',
      label: t('number'),
      hint: t('numberHint'),
      required: true,
      maxLength: 20,
      defaultValue: b?.number,
    },
    {
      kind: 'text',
      name: 'category',
      label: t('category'),
      hint: t('categoryHint'),
      maxLength: 40,
      defaultValue: b?.category ?? undefined,
    },
    {
      kind: 'number',
      name: 'width',
      label: t('width'),
      required: true,
      defaultValue: b ? metres(b.width) : '3',
    },
    {
      kind: 'number',
      name: 'height',
      label: t('depth'),
      required: true,
      defaultValue: b ? metres(b.height) : '3',
    },
    {
      kind: 'number',
      name: 'x',
      label: t('x'),
      hint: t('positionHint'),
      required: true,
      defaultValue: b ? metres(b.x) : '0',
    },
    { kind: 'number', name: 'y', label: t('y'), required: true, defaultValue: b ? metres(b.y) : '0' },
  ];
  const size = (b: BoothDto) => {
    const s = boothSize(b);
    return t('size', { width: s.width, depth: s.depth, area: s.area });
  };
  return (
    <>
      <nav aria-label={t('breadcrumb')}>
        <Link
          href={`${base}/exhibitors`}
          className="inline-flex min-h-6 items-center text-caption text-zinc-600"
        >
          {t('back')}
        </Link>
      </nav>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {canWrite ? null : <p className="text-body text-zinc-500">{tp('viewerNotice')}</p>}

      {warnings.length ? (
        <section aria-labelledby="booth-warnings-heading" className="flex flex-col gap-2">
          <h2 id="booth-warnings-heading" className="text-section">
            {t('warningsHeading', { count: warnings.length })}
          </h2>
          {warnings.map((w) => (
            <ScheduleWarning key={w}>{w}</ScheduleWarning>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="booth-map-heading" className="flex flex-col gap-3">
        <h2 id="booth-map-heading" className="text-section">
          {t('mapHeading')}
        </h2>
        {plan.booths.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : canWrite && program.exhibitors.length ? (
          <BoothDragAssign
            booths={plan.booths.map((b) => ({ ...b, taken: b.exhibitors.length > 0 }))}
            exhibitors={program.exhibitors.map((x) => ({ id: x.id, name: x.name }))}
            action={dropAssignAction.bind(null, org, event)}
            labels={{
              map: t('mapLabel'),
              drag: t('dragHint'),
              chips: t('dragExhibitors'),
              assigned: t('dropped'),
              failed: t('dropFailed'),
            }}
          />
        ) : (
          <BoothMap
            booths={plan.booths.map((b) => ({ ...b, taken: b.exhibitors.length > 0 }))}
            label={t('mapLabel')}
          />
        )}
      </section>

      <section aria-labelledby="booth-list-heading" className="flex flex-col gap-3">
        <h2 id="booth-list-heading" className="text-section">
          {t('listHeading', { count: plan.booths.length })}
        </h2>
        {plan.booths.length ? (
          <ul className="flex list-none flex-col gap-3 p-0">
            {plan.booths.map((b) => (
              <li key={b.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-body font-medium">{t('boothNamed', { number: b.number })}</h3>
                    {b.category ? <Chip tone="neutral">{b.category}</Chip> : null}
                  </div>
                  <p className="text-caption text-zinc-600">{size(b)}</p>
                  {b.exhibitors.length === 0 ? (
                    <p className="text-caption text-zinc-500">{t('unassigned')}</p>
                  ) : (
                    <ul
                      className="flex list-none flex-col gap-1 p-0"
                      aria-label={t('atBooth', { number: b.number })}
                    >
                      {b.exhibitors.map((e) => (
                        <li key={e.exhibitorId} className="flex flex-wrap items-center gap-2">
                          <span className="text-body">{nameOf(e.exhibitorId)}</span>
                          <span className="text-caption text-zinc-600">
                            {e.isPrimary ? t('primary') : t('coExhibitor')}
                          </span>
                          {canWrite ? (
                            <span className="ms-auto flex gap-2">
                              {e.isPrimary ? null : (
                                <form action={makePrimaryAction.bind(null, org, event, b.id, e.exhibitorId)}>
                                  <Button type="submit" variant="ghost" size="sm">
                                    {t('makePrimary', { name: nameOf(e.exhibitorId), number: b.number })}
                                  </Button>
                                </form>
                              )}
                              <form action={unassignBoothAction.bind(null, org, event, b.id, e.exhibitorId)}>
                                <Button type="submit" variant="ghost" size="sm">
                                  {t('removeFrom', { name: nameOf(e.exhibitorId), number: b.number })}
                                </Button>
                              </form>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canWrite ? (
                    <details className="border-t border-zinc-100 pt-2">
                      <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
                        {t('editNamed', { number: b.number })}
                      </summary>
                      <div className="flex flex-col gap-3 pt-3">
                        <ProgramForm
                          action={saveBoothAction.bind(null, org, event, b.id)}
                          fields={fields(b)}
                          idPrefix={`booth-${b.id}`}
                          submitLabel={tp('save')}
                          successLabel={tp('saved')}
                          errors={errors}
                        />
                        <form action={deleteBoothAction.bind(null, org, event, b.id)}>
                          <Button type="submit" variant="ghost" size="sm">
                            {t('deleteNamed', { number: b.number })}
                          </Button>
                        </form>
                      </div>
                    </details>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {canWrite ? (
        <>
          <section aria-labelledby="assign-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h2 id="assign-heading" className="text-section">
                {t('assignHeading')}
              </h2>
              {plan.booths.length && program.exhibitors.length ? (
                <ProgramForm
                  action={assignBoothAction.bind(null, org, event)}
                  fields={[
                    {
                      kind: 'select',
                      name: 'boothId',
                      label: t('booth'),
                      options: plan.booths.map((b) => ({ value: b.id, label: b.number })),
                    },
                    {
                      kind: 'select',
                      name: 'exhibitorId',
                      label: t('exhibitor'),
                      options: program.exhibitors.map((x) => ({ value: x.id, label: x.name })),
                    },
                    {
                      kind: 'checkboxes',
                      name: 'primary',
                      label: t('primaryLegend'),
                      options: [{ value: '1', label: t('makeThemPrimary') }],
                    },
                  ]}
                  idPrefix="assign"
                  submitLabel={t('assign')}
                  successLabel={t('assigned')}
                  errors={{
                    already_assigned: t('errors.already_assigned'),
                    exhibitorId: t('errors.exhibitor'),
                  }}
                />
              ) : (
                <p className="text-body text-zinc-600">{t('assignNeeds')}</p>
              )}
            </Card>
          </section>
          <section aria-labelledby="add-booth-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h2 id="add-booth-heading" className="text-section">
                {t('addBooth')}
              </h2>
              <ProgramForm
                action={saveBoothAction.bind(null, org, event, null)}
                fields={fields()}
                idPrefix="new-booth"
                submitLabel={t('addBooth')}
                successLabel={t('boothAdded')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        </>
      ) : null}
    </>
  );
}
