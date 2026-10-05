import 'server-only';
import {
  ATTRIBUTION_MODELS,
  type AttributionModel,
  type COUNT_MEASURES,
  EXPLORER_DIMENSIONS,
  type ExploreDto,
  type ExplorerDimension,
  exploreMoneyQuery,
  exploreQuery,
  GRANULARITIES,
  type Granularity,
  isMoneyMeasure,
  MEASURES,
  type Measure,
  RANGE_PRESETS,
  type RangePreset,
} from '@yayatoh/analytics';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { moneyText } from '@/components/marketing-analytics.tsx';
import { bucketLabel } from '@/components/org-analytics.tsx';
import { campaignNames } from './campaign-names.ts';
import type { ConsoleData } from './console.ts';
import { ports } from './ports.ts';

/**
 * The explorer's request from the URL (M6.2b): closed choices only — anything unknown falls back
 * to the default, and a money measure falls back to a count for members without finance.
 */
export interface ExplorerChoice {
  readonly measure: Measure;
  readonly dimension: ExplorerDimension;
  readonly model: AttributionModel;
  readonly range: RangePreset;
  readonly granularity: Granularity;
  readonly from?: string;
  readonly to?: string;
  readonly eventId?: string;
}

type Params = Readonly<Record<string, string | undefined>>;
const pick = <T extends string>(v: string | undefined, all: readonly T[], d: T): T =>
  (all as readonly string[]).includes(v ?? '') ? (v as T) : d;
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export function parseExplorer(sp: Params, canMoney: boolean): { choice: ExplorerChoice; badDate: boolean } {
  let measure = pick(sp.measure, MEASURES, 'registrations');
  if (isMoneyMeasure(measure) && !canMoney) measure = 'registrations';
  const from = day(sp.from);
  const to = day(sp.to);
  return {
    choice: {
      measure,
      dimension: pick(sp.dim, EXPLORER_DIMENSIONS, 'period'),
      model: pick(sp.model, ATTRIBUTION_MODELS, 'linear'),
      range: pick(sp.range, RANGE_PRESETS, '30d'),
      granularity: pick(sp.view, GRANULARITIES, 'day'),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(uuid(sp.event) ? { eventId: uuid(sp.event) } : {}),
    },
    badDate: Boolean((sp.from && !from) || (sp.to && !to)),
  };
}

/** The URL query of a choice (links, the CSV export, saved views). */
export function explorerQuery(c: ExplorerChoice): string {
  const q = new URLSearchParams({
    measure: c.measure,
    dim: c.dimension,
    model: c.model,
    range: c.range,
    view: c.granularity,
  });
  if (c.range === 'custom') {
    if (c.from) q.set('from', c.from);
    if (c.to) q.set('to', c.to);
  }
  if (c.eventId) q.set('event', c.eventId);
  return q.toString();
}

/** Run the explorer: the money query for money measures (finance only), else the counts one. */
export async function runExplorer(data: ConsoleData, c: ExplorerChoice): Promise<ExploreDto> {
  const input = {
    dimension: c.dimension,
    model: c.model,
    granularity: c.granularity,
    range: c.range,
    ...(c.range === 'custom' ? { from: c.from, to: c.to } : {}),
    ...(c.eventId ? { eventId: c.eventId } : {}),
  };
  if (isMoneyMeasure(c.measure)) {
    if (!roleCan(data.role, 'finance:read')) throw new Error('explorer: money without finance');
    return executeQuery(exploreMoneyQuery, { ...input, measure: c.measure }, data.ctx, ports);
  }
  return executeQuery(
    exploreQuery,
    { ...input, measure: c.measure as (typeof COUNT_MEASURES)[number] },
    data.ctx,
    ports,
  );
}

/** The validation reason of an explorer error the page words inline, else null (a real error). */
export function explorerProblem(err: unknown): string | null {
  if (!isDomainError(err)) return null;
  const reason = String(err.details?.reason ?? '');
  if (err.code === 'validation_failed' && reason) return reason;
  if (err.code === 'not_found') return 'not_found';
  return null;
}

export interface Labels {
  readonly none: string;
  readonly unnamedCampaign: string;
  readonly weekOf: (day: string) => string;
}

/** Every row's label in the reader's words (dates, event and campaign names, "None"). */
export async function rowLabels(
  data: ConsoleData,
  dto: ExploreDto,
  locale: string,
  l: Labels,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids =
    dto.dimension === 'campaign'
      ? dto.rows.filter((r) => r.key.startsWith('c.')).map((r) => r.key.slice(2))
      : [];
  const names = ids.length ? await campaignNames(data.ctx, ids) : new Map<string, string>();
  for (const r of dto.rows) {
    let label: string;
    if (dto.dimension === 'period') label = bucketLabel(r.key, dto.granularity, locale, l.weekOf);
    else if (dto.dimension === 'campaign' && r.key.startsWith('c.'))
      label = names.get(r.key.slice(2)) ?? l.unnamedCampaign;
    else label = r.label ?? l.none;
    out.set(r.key, label);
  }
  return out;
}

/** A value in its unit, for the page. */
export function valueText(
  dto: Pick<ExploreDto, 'unit'>,
  value: number,
  currency: string | null,
  locale: string,
) {
  if (dto.unit === 'minor') return moneyText(value, currency ?? 'USD', locale);
  if (dto.unit === 'order_bps')
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Math.trunc(value / 100) / 100,
    );
  return new Intl.NumberFormat(locale).format(value);
}
