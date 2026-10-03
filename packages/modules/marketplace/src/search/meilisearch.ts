import { SearchDocument } from './document.ts';
import {
  FACET_FIELDS,
  FILTER_FIELDS,
  type Filter,
  SEARCHABLE_FIELDS,
  type SearchHits,
  type SearchIndex,
  type SearchQuery,
  SORT_FIELDS,
  type Sort,
} from './port.ts';

export interface MeilisearchConfig {
  /** e.g. `https://ms-xxxx.meilisearch.io` (no trailing slash). */
  readonly url: string;
  /** Writes and settings (the admin API key). Server-side only. */
  readonly adminKey: string;
  /** Searches (a search-only key). Server-side only: the browser never talks to Meilisearch. */
  readonly searchKey: string;
  readonly index?: string;
  readonly fetch?: typeof fetch;
  /** How long a write waits for its task (ms). */
  readonly taskTimeoutMs?: number;
  /** Tell the caller it is the per-process fake (dev and CI). */
  readonly inMemory?: boolean;
}

export const DEFAULT_INDEX = 'yayatoh_listings';

export class MeilisearchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'MeilisearchError';
  }
}

/** A filter value in Meilisearch's filter syntax: numbers as is, strings double-quoted. */
export function filterValue(v: string | number): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('filter value must be finite');
    return String(v);
  }
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The filter expressions of a query (all must hold: Meilisearch ANDs the array). */
export function toMeiliFilter(filters: readonly Filter[]): string[] {
  const out: string[] = [];
  for (const f of filters) {
    if ('geo' in f) {
      const { lat, lng, radiusM } = f.geo;
      out.push(`_geoRadius(${filterValue(lat)}, ${filterValue(lng)}, ${filterValue(Math.round(radiusM))})`);
    } else if ('eq' in f) out.push(`${f.field} = ${filterValue(f.eq)}`);
    else if ('ne' in f) out.push(`${f.field} != ${filterValue(f.ne)}`);
    else {
      if (f.gte !== undefined) out.push(`${f.field} >= ${filterValue(f.gte)}`);
      if (f.lt !== undefined) out.push(`${f.field} < ${filterValue(f.lt)}`);
    }
  }
  return out;
}

export function toMeiliSort(sort: readonly Sort[]): string[] {
  return sort.map((s) =>
    'nearest' in s
      ? `_geoPoint(${filterValue(s.nearest.lat)}, ${filterValue(s.nearest.lng)}):asc`
      : `${s.field}:${s.dir}`,
  );
}

/** The search request body of one query (used for `/multi-search`). */
export function toMeiliQuery(index: string, q: SearchQuery): Record<string, unknown> {
  return {
    indexUid: index,
    q: q.text ?? '',
    filter: toMeiliFilter(q.filters),
    ...(q.facets?.length ? { facets: [...q.facets] } : {}),
    ...(q.sort?.length ? { sort: toMeiliSort(q.sort) } : {}),
    page: Math.max(1, q.page),
    hitsPerPage: Math.max(0, q.hitsPerPage),
  };
}

/** The index settings: what may be filtered, sorted, searched and returned. */
export const INDEX_SETTINGS = {
  searchableAttributes: [...SEARCHABLE_FIELDS],
  filterableAttributes: [...FILTER_FIELDS, '_geo'],
  sortableAttributes: [...SORT_FIELDS, '_geo'],
  displayedAttributes: Object.keys(SearchDocument.shape),
  faceting: { maxValuesPerFacet: 100 },
  pagination: { maxTotalHits: 5000 },
} as const;

interface MeiliResult {
  hits?: (Record<string, unknown> & { _geoDistance?: number })[];
  totalHits?: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

/**
 * The Meilisearch adapter (M6.14a): the HTTP API with the admin key for writes and the search key
 * for reads. Every write waits for its task (a failed task throws, so the subscriber retries).
 * Returned hits are parsed against the document allowlist again.
 */
export function meilisearchIndex(cfg: MeilisearchConfig): SearchIndex {
  const index = cfg.index ?? DEFAULT_INDEX;
  const f = cfg.fetch ?? fetch;
  const base = cfg.url.replace(/\/+$/, '');
  const timeout = cfg.taskTimeoutMs ?? 10_000;

  async function call<T>(method: string, path: string, key: string, body?: unknown): Promise<T> {
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) {
      let code = '';
      try {
        code = String((JSON.parse(text) as { code?: string }).code ?? '');
      } catch {
        // not JSON
      }
      throw new MeilisearchError(`Meilisearch ${method} ${path}: ${res.status} ${code}`.trim(), res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async function waitTask(task: { taskUid?: number }): Promise<void> {
    if (task.taskUid === undefined) return;
    const until = Date.now() + timeout;
    for (;;) {
      const t = await call<{ status: string; error?: { code?: string } }>(
        'GET',
        `/tasks/${task.taskUid}`,
        cfg.adminKey,
      );
      if (t.status === 'succeeded') return;
      if (t.status === 'failed' || t.status === 'canceled')
        throw new MeilisearchError(
          `Meilisearch task ${task.taskUid} ${t.status} ${t.error?.code ?? ''}`,
          500,
        );
      if (Date.now() > until) throw new MeilisearchError(`Meilisearch task ${task.taskUid} timed out`, 504);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const write = async (method: string, path: string, body?: unknown) =>
    waitTask(await call<{ taskUid?: number }>(method, path, cfg.adminKey, body));

  return {
    name: 'meilisearch',
    inMemory: cfg.inMemory === true,
    async setup() {
      try {
        await call('GET', `/indexes/${index}`, cfg.adminKey);
      } catch (err) {
        if (!(err instanceof MeilisearchError) || err.status !== 404) throw err;
        await write('POST', '/indexes', { uid: index, primaryKey: 'id' });
      }
      await write('PATCH', `/indexes/${index}/settings`, INDEX_SETTINGS);
    },
    async upsert(docs) {
      if (docs.length === 0) return;
      await write(
        'POST',
        `/indexes/${index}/documents?primaryKey=id`,
        docs.map((d) => {
          // No location: leave `_geo` out (geo filters skip the document).
          const { _geo, ...rest } = SearchDocument.parse(d);
          return _geo ? { ...rest, _geo } : rest;
        }),
      );
    },
    async remove(ids) {
      if (ids.length === 0) return;
      await write('POST', `/indexes/${index}/documents/delete-batch`, [...ids]);
    },
    async clear() {
      await write('DELETE', `/indexes/${index}/documents`);
    },
    async search(queries) {
      if (queries.length === 0) return [];
      const body = { queries: queries.map((q) => toMeiliQuery(index, q)) };
      const res = await call<{ results: MeiliResult[] }>('POST', '/multi-search', cfg.searchKey, body);
      return res.results.map((r): SearchHits => {
        const facets: Record<string, Record<string, number>> = {};
        for (const k of FACET_FIELDS) if (r.facetDistribution?.[k]) facets[k] = r.facetDistribution[k];
        return {
          total: r.totalHits ?? 0,
          facets,
          hits: (r.hits ?? []).map((h) => {
            const { _geoDistance, _formatted: _f, _rankingScore: _s, ...doc } = h as Record<string, unknown>;
            return {
              doc: SearchDocument.parse({ _geo: null, ...doc }),
              distanceM: typeof _geoDistance === 'number' ? _geoDistance : null,
            };
          }),
        };
      });
    },
  };
}
