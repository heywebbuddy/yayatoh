'use client';

import {
  COMPARISONS,
  CONDITION_TYPES,
  type ConditionType,
  emptySegment,
  MAX_SEGMENT_CONDITIONS,
  MAX_SEGMENT_DEPTH,
  SegmentDefinition,
  type SegmentScope,
  TEMPLATE_KEYS,
  TEMPLATE_PARAMS,
  type TemplateKey,
  TOTAL_METRICS,
  templateDefinition,
} from '@yayatoh/audiences/client';
import { Alert, Button, Input, Table } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useActionState, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PreviewResult, SaveAudienceState } from '@/app/[locale]/o/[org]/(org)/audiences/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

// Draft nodes are loose (a half-typed label is still a draft); the DSL schema decides validity.
type Draft = Record<string, unknown> & { type: string };
interface DraftGroup {
  type: 'group';
  op: 'and' | 'or';
  conditions: (Draft | DraftGroup)[];
}
type Node = Draft | DraftGroup;
const isGroup = (n: Node): n is DraftGroup => n.type === 'group';

export interface BuilderEvent {
  readonly id: string;
  readonly name: string;
  readonly date: string;
}
export interface BuilderSeries {
  readonly id: string;
  readonly name: string;
}

const SELECT = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
const SCOPE_KINDS = ['any', 'event', 'series', 'previousEdition', 'eventsBetween'] as const;

function newCondition(type: ConditionType, events: readonly BuilderEvent[], currency: string): Draft {
  const eventScope: SegmentScope = events[0] ? { kind: 'event', eventId: events[0].id } : { kind: 'any' };
  switch (type) {
    case 'participation':
      return {
        type,
        scope: eventScope,
        negate: false,
        role: 'attendee',
        ticketTypeIds: [],
        seated: null,
        checkedIn: null,
        registeredFrom: null,
        registeredTo: null,
      };
    case 'spend':
      return { type, scope: { kind: 'any' }, currency, op: 'gte', amountMinor: 0 };
    case 'consent':
      return { type, channel: 'email', granted: true };
    case 'label':
      return { type, scope: { kind: 'any' }, label: '', negate: false };
    case 'totals':
      return { type, metric: 'events', op: 'gte', value: 1 };
    case 'seen':
      return { type, which: 'last', from: null, to: null };
  }
}

const countLeaves = (n: Node): number =>
  isGroup(n) ? n.conditions.reduce((s, c) => s + countLeaves(c), 0) : 1;

/** Replace the node at `path` (indexes from the root group). */
function update(root: DraftGroup, path: readonly number[], fn: (n: Node) => Node | null): DraftGroup {
  if (path.length === 0) return (fn(root) as DraftGroup | null) ?? root;
  const [i, ...rest] = path as [number, ...number[]];
  const next = root.conditions.flatMap((c, j) => {
    if (j !== i) return [c];
    const r = rest.length === 0 ? fn(c) : isGroup(c) ? update(c, rest, fn) : c;
    return r ? [r] : [];
  });
  return { ...root, conditions: next };
}

/**
 * The audience builder (M3.6): conditions and AND/OR groups over the org's people, a live count
 * and the first matches, the vision's three templates, and saving. Every control is a native form
 * control (keyboard-only operable); the count is announced politely.
 */
export function AudienceBuilder({
  initial,
  segmentId,
  name,
  events,
  series,
  currency,
  canSave,
  template,
  preview,
  ticketTypes,
  save,
}: {
  initial: SegmentDefinition | null;
  segmentId: string | null;
  name: string;
  events: readonly BuilderEvent[];
  series: readonly BuilderSeries[];
  currency: string;
  canSave: boolean;
  template: TemplateKey | null;
  preview: (definitionJson: string) => Promise<PreviewResult>;
  ticketTypes: (eventId: string) => Promise<{ id: string; name: string }[]>;
  save: (prev: SaveAudienceState, form: FormData) => Promise<SaveAudienceState>;
}) {
  const t = useTranslations('audiences');
  const te = useTranslations();
  const locale = useLocale();
  const [root, setRoot] = useState<DraftGroup>(
    () => (initial ?? emptySegment()).root as unknown as DraftGroup,
  );
  const [types, setTypes] = useState<Record<string, { id: string; name: string }[]>>({});
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, saveAction, saving] = useActionState(save, { ok: false, code: null });
  const parsed = useMemo(() => SegmentDefinition.safeParse({ version: 1, root }), [root]);
  const json = parsed.success ? JSON.stringify(parsed.data) : null;
  const seq = useRef(0);

  // Live count: re-run the preview shortly after the last change, keeping only the newest answer.
  useEffect(() => {
    if (!json) return;
    const mine = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      preview(json).then((r) => {
        if (seq.current !== mine) return;
        setResult(r);
        setBusy(false);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [json, preview]);

  // Ticket types of every event a condition points at (for the ticket-type checkboxes).
  const eventIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (n: Node) => {
      if (isGroup(n)) n.conditions.forEach(walk);
      else if (n.type === 'participation') {
        const s = n.scope as SegmentScope;
        if (s.kind === 'event') ids.add(s.eventId);
      }
    };
    walk(root);
    return [...ids];
  }, [root]);
  useEffect(() => {
    for (const id of eventIds)
      if (!types[id])
        ticketTypes(id).then((list) => setTypes((prev) => (prev[id] ? prev : { ...prev, [id]: list })));
  }, [eventIds, types, ticketTypes]);

  const leaves = countLeaves(root);
  const set = (path: readonly number[], fn: (n: Node) => Node | null) => setRoot((r) => update(r, path, fn));
  const nf = new Intl.NumberFormat(locale);
  const df = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  return (
    <div className="flex flex-col gap-6">
      <Templates
        events={events}
        initialKey={template}
        ticketTypes={ticketTypes}
        onUse={(d) => setRoot(d.root as unknown as DraftGroup)}
      />

      <section aria-labelledby="builder-heading" className="flex flex-col gap-3">
        <h2 id="builder-heading" className="text-section">
          {t('builder.title')}
        </h2>
        <GroupEditor
          group={root}
          path={[]}
          depth={1}
          canAdd={leaves < MAX_SEGMENT_CONDITIONS}
          events={events}
          series={series}
          currency={currency}
          types={types}
          set={set}
        />
        {!parsed.success ? (
          <p className="text-caption text-pink-700" role="status">
            {t('builder.incomplete')}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="preview-heading" className="flex flex-col gap-3">
        <h2 id="preview-heading" className="text-section">
          {t('preview.title')}
        </h2>
        <p
          aria-live="polite"
          aria-atomic="true"
          className="text-body font-medium"
          data-testid="audience-count"
        >
          {!parsed.success
            ? t('preview.waiting')
            : busy && !result
              ? t('preview.counting')
              : result?.ok
                ? t('preview.count', {
                    count: result.preview.count,
                    formatted: nf.format(result.preview.count),
                  })
                : result
                  ? te(errorMessageKey(result.code))
                  : t('preview.counting')}
        </p>
        {result?.ok && result.preview.rows.length > 0 ? (
          <Table
            caption={t('preview.caption', { shown: result.preview.rows.length })}
            captionHidden={false}
            rowKey={(r) => r.contactId}
            rows={result.preview.rows}
            columns={[
              { key: 'name', header: t('preview.name'), cell: (r) => r.name ?? t('preview.noName') },
              { key: 'email', header: t('preview.email'), cell: (r) => <bdi>{r.email}</bdi> },
              {
                key: 'events',
                header: t('preview.events'),
                align: 'end',
                cell: (r) => <span className="font-mono">{nf.format(r.events)}</span>,
              },
              {
                key: 'attended',
                header: t('preview.attended'),
                align: 'end',
                cell: (r) => <span className="font-mono">{nf.format(r.eventsAttended)}</span>,
              },
              {
                key: 'lastSeen',
                header: t('preview.lastSeen'),
                cell: (r) => (r.lastSeenAt ? df.format(new Date(r.lastSeenAt)) : '—'),
              },
            ]}
          />
        ) : null}
      </section>

      {canSave ? (
        <section aria-labelledby="save-heading" className="flex flex-col gap-3">
          <h2 id="save-heading" className="text-section">
            {t('save.title')}
          </h2>
          <form action={saveAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="definition" value={json ?? ''} />
            <div className="min-w-64 flex-1">
              <Input
                name="name"
                id="audience-name"
                label={t('save.name')}
                defaultValue={name}
                required
                maxLength={120}
                error={
                  saved.field === 'name'
                    ? t(`save.errors.${saved.code === 'conflict' ? 'taken' : 'name'}`)
                    : undefined
                }
              />
            </div>
            <Button type="submit" disabled={saving || !parsed.success}>
              {segmentId ? t('save.update') : t('save.submit')}
            </Button>
          </form>
          {saved.code && saved.field !== 'name' ? (
            <div aria-live="polite">
              <Alert title={te(errorMessageKey(saved.code))} />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Templates({
  events,
  initialKey,
  ticketTypes,
  onUse,
}: {
  events: readonly BuilderEvent[];
  initialKey: TemplateKey | null;
  ticketTypes: (eventId: string) => Promise<{ id: string; name: string }[]>;
  onUse: (d: SegmentDefinition) => void;
}) {
  const t = useTranslations('audiences');
  const [key, setKey] = useState<TemplateKey>(initialKey ?? 'vipsWithoutSeats');
  const [eventId, setEventId] = useState(events[0]?.id ?? '');
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [used, setUsed] = useState<TemplateKey | null>(null);
  const id = useId();
  const needsTypes = TEMPLATE_PARAMS[key].includes('ticketTypeIds');
  useEffect(() => {
    setPicked([]);
    if (!eventId || !needsTypes) return setTypes([]);
    let live = true;
    ticketTypes(eventId).then((list) => {
      if (live) setTypes(list);
    });
    return () => {
      live = false;
    };
  }, [eventId, needsTypes, ticketTypes]);
  const ready = eventId !== '' && (!needsTypes || picked.length > 0);
  return (
    <section
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-3 rounded-panel border border-zinc-200 bg-white px-5 py-4"
    >
      <h2 id={`${id}-h`} className="text-section">
        {t('templates.title')}
      </h2>
      <p className="text-caption text-zinc-500">{t('templates.description')}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-zinc-600">{t('templates.pick')}</legend>
        {TEMPLATE_KEYS.map((k) => (
          <label key={k} className="flex min-h-6 items-start gap-2 text-body">
            <input
              type="radio"
              name={`${id}-template`}
              value={k}
              checked={key === k}
              onChange={() => setKey(k)}
              className="mt-1 size-4"
            />
            <span className="flex flex-col">
              <span className="font-medium">{t(`templates.${k}.name`)}</span>
              <span className="text-caption text-zinc-500">{t(`templates.${k}.description`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-caption text-zinc-600">
          {key === 'lastYearNotThisYear' ? t('templates.thisYearsEvent') : t('templates.event')}
          <select className={SELECT} value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {events.length === 0 ? <option value="">{t('templates.noEvents')}</option> : null}
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {t('eventOption', { name: e.name, date: e.date })}
              </option>
            ))}
          </select>
        </label>
        {needsTypes ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-caption text-zinc-600">{t('templates.ticketTypes')}</legend>
            {types.length === 0 ? (
              <p className="text-caption text-zinc-500">{t('templates.noTicketTypes')}</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {types.map((tt) => (
                  <label key={tt.id} className="flex min-h-6 items-center gap-2 text-body">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={picked.includes(tt.id)}
                      onChange={(e) =>
                        setPicked((p) => (e.target.checked ? [...p, tt.id] : p.filter((x) => x !== tt.id)))
                      }
                    />
                    {tt.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={!ready}
          onClick={() => {
            onUse(templateDefinition(key, { eventId, ticketTypeIds: picked }));
            setUsed(key);
          }}
        >
          {t('templates.use')}
        </Button>
      </div>
      <p aria-live="polite" className="text-caption text-zinc-600">
        {used ? t('templates.used', { name: t(`templates.${used}.name`) }) : ''}
      </p>
    </section>
  );
}

interface EditorProps {
  events: readonly BuilderEvent[];
  series: readonly BuilderSeries[];
  currency: string;
  types: Record<string, { id: string; name: string }[]>;
  set: (path: readonly number[], fn: (n: Node) => Node | null) => void;
}

function GroupEditor({
  group,
  path,
  depth,
  canAdd,
  ...p
}: EditorProps & { group: DraftGroup; path: readonly number[]; depth: number; canAdd: boolean }) {
  const t = useTranslations('audiences.builder');
  const [adding, setAdding] = useState<ConditionType>('participation');
  const id = useId();
  const title = path.length === 0 ? t('rootGroup') : t('group', { n: path.map((i) => i + 1).join('.') });
  return (
    <fieldset
      className="flex flex-col gap-3 rounded-panel border border-zinc-200 bg-white px-4 py-3"
      data-testid={`group-${path.join('-') || 'root'}`}
    >
      <legend className="px-1 text-body font-medium">{title}</legend>
      <label className="flex flex-wrap items-center gap-2 text-caption text-zinc-600">
        {t('match')}
        <select
          className={SELECT}
          value={group.op}
          onChange={(e) => p.set(path, (g) => ({ ...(g as DraftGroup), op: e.target.value as 'and' | 'or' }))}
        >
          <option value="and">{t('all')}</option>
          <option value="or">{t('any')}</option>
        </select>
      </label>
      {group.conditions.length === 0 ? <p className="text-caption text-zinc-500">{t('emptyGroup')}</p> : null}
      <ol className="flex list-none flex-col gap-3 p-0">
        {group.conditions.map((c, i) => {
          const at = [...path, i];
          return (
            <li key={i}>
              {isGroup(c) ? (
                <GroupEditor group={c} path={at} depth={depth + 1} canAdd={canAdd} {...p} />
              ) : (
                <ConditionEditor node={c} path={at} {...p} />
              )}
              {isGroup(c) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1"
                  onClick={() => p.set(at, () => null)}
                  aria-label={t('removeGroup', { n: at.map((x) => x + 1).join('.') })}
                >
                  {t('remove')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-caption text-zinc-600" htmlFor={`${id}-type`}>
          {t('conditionType')}
        </label>
        <select
          id={`${id}-type`}
          className={SELECT}
          value={adding}
          onChange={(e) => setAdding(e.target.value as ConditionType)}
        >
          {CONDITION_TYPES.map((ct) => (
            <option key={ct} value={ct}>
              {t(`types.${ct}`)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!canAdd}
          onClick={() =>
            p.set(path, (g) => ({
              ...(g as DraftGroup),
              conditions: [...(g as DraftGroup).conditions, newCondition(adding, p.events, p.currency)],
            }))
          }
        >
          {t('addCondition')}
        </Button>
        {depth < MAX_SEGMENT_DEPTH ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              p.set(path, (g) => ({
                ...(g as DraftGroup),
                conditions: [...(g as DraftGroup).conditions, { type: 'group', op: 'or', conditions: [] }],
              }))
            }
          >
            {t('addGroup')}
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}

const TRI = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : 'any');
const fromTri = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null);

function ConditionEditor({ node, path, ...p }: EditorProps & { node: Draft; path: readonly number[] }) {
  const t = useTranslations('audiences.builder');
  const n = path.map((i) => i + 1).join('.');
  const put = (patch: Record<string, unknown>) => p.set(path, (c) => ({ ...(c as Draft), ...patch }));
  const field = (label: string, control: ReactNode) => (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in and rendered inside the label.
    <label className="flex flex-col gap-1.5 text-caption text-zinc-600">
      {label}
      {control}
    </label>
  );
  const select = (
    value: string,
    options: readonly (readonly [string, string])[],
    on: (v: string) => void,
  ) => (
    <select className={SELECT} value={value} onChange={(e) => on(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  const date = (label: string, key: string) =>
    field(
      label,
      <input
        type="date"
        className={SELECT}
        value={(node[key] as string | null) ?? ''}
        onChange={(e) => put({ [key]: e.target.value || null })}
      />,
    );
  const ops = COMPARISONS.map((o) => [o, t(`ops.${o}`)] as const);
  const scope = node.scope as SegmentScope | undefined;
  const eventTypes = scope?.kind === 'event' ? (p.types[scope.eventId] ?? []) : [];
  return (
    <fieldset
      className="flex flex-col gap-3 rounded-card border border-zinc-200 px-4 py-3"
      data-testid={`condition-${path.join('-')}`}
    >
      <legend className="px-1 text-body font-medium">
        {t('condition', { n, type: t(`types.${node.type as ConditionType}`) })}
      </legend>
      <div className="flex flex-wrap items-end gap-3">
        {node.type === 'participation' ? (
          <>
            {field(
              t('did'),
              select(
                String(node.negate ? 'no' : 'yes'),
                [
                  ['yes', t('didYes')],
                  ['no', t('didNo')],
                ],
                (v) => put({ negate: v === 'no' }),
              ),
            )}
            {field(
              t('role'),
              select(
                String(node.role),
                [
                  ['attendee', t('roles.attendee')],
                  ['buyer', t('roles.buyer')],
                ],
                (v) => put({ role: v }),
              ),
            )}
            {scope ? (
              <ScopeEditor scope={scope} put={(s) => put({ scope: s, ticketTypeIds: [] })} {...p} />
            ) : null}
            {field(
              t('seated'),
              select(
                TRI(node.seated),
                [
                  ['any', t('tri.any')],
                  ['yes', t('tri.yes')],
                  ['no', t('tri.no')],
                ],
                (v) => put({ seated: fromTri(v) }),
              ),
            )}
            {field(
              t('checkedIn'),
              select(
                TRI(node.checkedIn),
                [
                  ['any', t('tri.any')],
                  ['yes', t('tri.yes')],
                  ['no', t('tri.no')],
                ],
                (v) => put({ checkedIn: fromTri(v) }),
              ),
            )}
            {date(t('registeredFrom'), 'registeredFrom')}
            {date(t('registeredTo'), 'registeredTo')}
            {eventTypes.length > 0 ? (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-caption text-zinc-600">{t('ticketTypes')}</legend>
                <div className="flex flex-wrap gap-3">
                  {eventTypes.map((tt) => {
                    const ids = (node.ticketTypeIds as string[]) ?? [];
                    return (
                      <label key={tt.id} className="flex min-h-6 items-center gap-2 text-body">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={ids.includes(tt.id)}
                          onChange={(e) =>
                            put({
                              ticketTypeIds: e.target.checked
                                ? [...ids, tt.id]
                                : ids.filter((x) => x !== tt.id),
                            })
                          }
                        />
                        {tt.name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
          </>
        ) : null}
        {node.type === 'spend' ? (
          <>
            {scope ? <ScopeEditor scope={scope} put={(s) => put({ scope: s })} {...p} /> : null}
            {field(
              t('currency'),
              <input
                className={SELECT}
                value={String(node.currency)}
                maxLength={3}
                size={4}
                onChange={(e) => put({ currency: e.target.value.toUpperCase() })}
              />,
            )}
            {field(
              t('comparison'),
              select(String(node.op), ops, (v) => put({ op: v })),
            )}
            {field(
              t('amount'),
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={SELECT}
                value={Number(node.amountMinor) / 100}
                onChange={(e) =>
                  put({ amountMinor: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })
                }
              />,
            )}
          </>
        ) : null}
        {node.type === 'consent' ? (
          <>
            {field(
              t('channel'),
              select(
                String(node.channel),
                [
                  ['email', t('channels.email')],
                  ['sms', t('channels.sms')],
                ],
                (v) => put({ channel: v }),
              ),
            )}
            {field(
              t('consentState'),
              select(
                node.granted ? 'yes' : 'no',
                [
                  ['yes', t('consentGranted')],
                  ['no', t('consentNotGranted')],
                ],
                (v) => put({ granted: v === 'yes' }),
              ),
            )}
          </>
        ) : null}
        {node.type === 'label' ? (
          <>
            {field(
              t('did'),
              select(
                node.negate ? 'no' : 'yes',
                [
                  ['yes', t('hadLabel')],
                  ['no', t('neverHadLabel')],
                ],
                (v) => put({ negate: v === 'no' }),
              ),
            )}
            {field(
              t('label'),
              <input
                className={SELECT}
                value={String(node.label ?? '')}
                maxLength={40}
                onChange={(e) => put({ label: e.target.value })}
              />,
            )}
            {scope ? <ScopeEditor scope={scope} put={(s) => put({ scope: s })} {...p} /> : null}
          </>
        ) : null}
        {node.type === 'totals' ? (
          <>
            {field(
              t('metric'),
              select(
                String(node.metric),
                TOTAL_METRICS.map((m) => [m, t(`metrics.${m}`)] as const),
                (v) => put({ metric: v }),
              ),
            )}
            {field(
              t('comparison'),
              select(String(node.op), ops, (v) => put({ op: v })),
            )}
            {field(
              t('value'),
              <input
                type="number"
                min={0}
                step={1}
                className={SELECT}
                value={Number(node.value)}
                onChange={(e) => put({ value: Math.max(0, Math.floor(Number(e.target.value || 0))) })}
              />,
            )}
          </>
        ) : null}
        {node.type === 'seen' ? (
          <>
            {field(
              t('which'),
              select(
                String(node.which),
                [
                  ['first', t('firstSeen')],
                  ['last', t('lastSeen')],
                ],
                (v) => put({ which: v }),
              ),
            )}
            {date(t('from'), 'from')}
            {date(t('to'), 'to')}
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => p.set(path, () => null)}
          aria-label={t('removeCondition', { n })}
        >
          {t('remove')}
        </Button>
      </div>
    </fieldset>
  );
}

function ScopeEditor({
  scope,
  put,
  events,
  series,
}: EditorProps & { scope: SegmentScope; put: (s: SegmentScope) => void }) {
  const t = useTranslations('audiences');
  const first = events[0]?.id ?? '';
  const today = new Date().toISOString().slice(0, 10);
  const change = (kind: (typeof SCOPE_KINDS)[number]) => {
    if (kind === 'any') put({ kind });
    else if (kind === 'event' || kind === 'previousEdition') put({ kind, eventId: first });
    else if (kind === 'series') put({ kind, seriesId: series[0]?.id ?? '' });
    else put({ kind, from: today, to: today });
  };
  const cls = SELECT;
  return (
    <>
      <label className="flex flex-col gap-1.5 text-caption text-zinc-600">
        {t('builder.scope')}
        <select
          className={cls}
          value={scope.kind}
          onChange={(e) => change(e.target.value as SegmentScope['kind'])}
        >
          {SCOPE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`scopes.${k}`)}
            </option>
          ))}
        </select>
      </label>
      {scope.kind === 'event' || scope.kind === 'previousEdition' ? (
        <label className="flex flex-col gap-1.5 text-caption text-zinc-600">
          {scope.kind === 'event' ? t('builder.event') : t('builder.editionOf')}
          <select
            className={cls}
            value={scope.eventId}
            onChange={(e) => put({ ...scope, eventId: e.target.value })}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {t('eventOption', { name: e.name, date: e.date })}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {scope.kind === 'series' ? (
        <label className="flex flex-col gap-1.5 text-caption text-zinc-600">
          {t('builder.series')}
          <select
            className={cls}
            value={scope.seriesId}
            onChange={(e) => put({ ...scope, seriesId: e.target.value })}
          >
            {series.length === 0 ? <option value="">{t('builder.noSeries')}</option> : null}
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {scope.kind === 'eventsBetween' ? (
        <>
          <label className="flex flex-col gap-1.5 text-caption text-zinc-600">
            {t('builder.from')}
            <input
              type="date"
              className={cls}
              value={scope.from}
              onChange={(e) => put({ ...scope, from: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-caption text-zinc-600">
            {t('builder.to')}
            <input
              type="date"
              className={cls}
              value={scope.to}
              onChange={(e) => put({ ...scope, to: e.target.value })}
            />
          </label>
        </>
      ) : null}
    </>
  );
}
