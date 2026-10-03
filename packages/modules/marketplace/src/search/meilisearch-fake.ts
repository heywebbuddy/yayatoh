import { SearchDocument } from './document.ts';
import { DEFAULT_INDEX, type MeilisearchConfig } from './meilisearch.ts';

/**
 * An in-memory Meilisearch for dev and CI (M6.14a): the subset of the HTTP API the adapter uses
 * (index create/get, settings, add-or-replace and delete documents, tasks, `/multi-search` with
 * filters, `_geoRadius`, `_geoPoint` sorting, facets and page/hitsPerPage). It never talks to the
 * network and is stricter than Meilisearch where it helps tests:
 * - writes and tasks need the admin key, searches the search (or admin) key;
 * - a filter, sort or facet on an attribute the settings don't allow is a 400, as in Meilisearch;
 * - every stored document must pass the `SearchDocument` allowlist (a leak would fail the write).
 * Text matching: every query word must start a word of a searchable attribute (case and accents
 * ignored; no typo tolerance).
 */
export interface FakeMeilisearchCall {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  /** Which key the call carried. */
  readonly key: 'admin' | 'search' | 'other' | 'none';
}

type Doc = Record<string, unknown> & { id: string };

interface Settings {
  searchableAttributes: string[];
  filterableAttributes: string[];
  sortableAttributes: string[];
}

export interface FakeMeilisearch {
  readonly config: Required<Pick<MeilisearchConfig, 'url' | 'adminKey' | 'searchKey' | 'index'>>;
  readonly fetch: typeof fetch;
  readonly calls: FakeMeilisearchCall[];
  /** The stored documents (id → document). */
  readonly documents: Map<string, Doc>;
  /** Whether the index exists (setup ran). */
  exists(): boolean;
  /** A full reindex has loaded this process's copy (dev and CI load it on first use). */
  loaded: boolean;
  reset(): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string, message = code) =>
  json(status, { code, message, type: 'invalid_request' });

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s: string) =>
  fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Haversine distance in metres (Meilisearch's formula). */
export function geoDistanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const NUM = '-?\\d+(?:\\.\\d+)?';
const STR = '"(?:[^"\\\\]|\\\\.)*"';
const COMPARE = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) (=|!=|>=|<=|>|<) (${STR}|${NUM})$`);
const GEO_RADIUS = new RegExp(`^_geoRadius\\((${NUM}), ?(${NUM}), ?(${NUM})\\)$`);
const GEO_POINT = new RegExp(`^_geoPoint\\((${NUM}), ?(${NUM})\\):(asc|desc)$`);
const SORT = /^([A-Za-z_][A-Za-z0-9_]*):(asc|desc)$/;

type Predicate = (d: Doc) => boolean;

function parseValue(raw: string): string | number {
  if (raw.startsWith('"')) return raw.slice(1, -1).replace(/\\(.)/g, '$1');
  return Number(raw);
}

function compileFilter(expr: string, filterable: readonly string[]): Predicate | Response {
  const geo = GEO_RADIUS.exec(expr);
  if (geo) {
    if (!filterable.includes('_geo')) return err(400, 'invalid_search_filter', '_geo is not filterable');
    const center = { lat: Number(geo[1]), lng: Number(geo[2]) };
    const radius = Number(geo[3]);
    return (d) => {
      const g = d._geo as { lat: number; lng: number } | undefined;
      return Boolean(g) && geoDistanceM(center, g as { lat: number; lng: number }) <= radius;
    };
  }
  const m = COMPARE.exec(expr);
  if (!m) return err(400, 'invalid_search_filter', `unsupported filter: ${expr}`);
  const [, attr = '', op, raw = ''] = m;
  if (!filterable.includes(attr)) return err(400, 'invalid_search_filter', `${attr} is not filterable`);
  const v = parseValue(raw);
  const eq = (a: unknown) => (typeof v === 'string' ? fold(String(a ?? '')) === fold(v) : Number(a) === v);
  switch (op) {
    case '=':
      return (d) => d[attr] !== null && d[attr] !== undefined && eq(d[attr]);
    case '!=':
      return (d) => !eq(d[attr]);
    case '>=':
      return (d) => typeof d[attr] === 'number' && (d[attr] as number) >= Number(v);
    case '<=':
      return (d) => typeof d[attr] === 'number' && (d[attr] as number) <= Number(v);
    case '>':
      return (d) => typeof d[attr] === 'number' && (d[attr] as number) > Number(v);
    default:
      return (d) => typeof d[attr] === 'number' && (d[attr] as number) < Number(v);
  }
}

export function fakeMeilisearch(): FakeMeilisearch {
  const config = {
    url: 'https://meilisearch.fake.invalid',
    adminKey: 'fake-meili-admin-key',
    searchKey: 'fake-meili-search-key',
    index: DEFAULT_INDEX,
  };
  const calls: FakeMeilisearchCall[] = [];
  const documents = new Map<string, Doc>();
  let exists = false;
  let settings: Settings = { searchableAttributes: ['*'], filterableAttributes: [], sortableAttributes: [] };
  let taskSeq = 0;
  const task = () => json(202, { taskUid: ++taskSeq, status: 'enqueued' });

  function runQuery(q: Record<string, unknown>): Record<string, unknown> | Response {
    if (q.indexUid !== config.index || !exists) return err(404, 'index_not_found');
    const preds: Predicate[] = [];
    const filter = (q.filter ?? []) as unknown[];
    if (!Array.isArray(filter)) return err(400, 'invalid_search_filter');
    for (const f of filter) {
      if (typeof f !== 'string') return err(400, 'invalid_search_filter', 'nested filters are not used');
      const p = compileFilter(f, settings.filterableAttributes);
      if (p instanceof Response) return p;
      preds.push(p);
    }
    const facets = (q.facets ?? []) as string[];
    for (const f of facets)
      if (!settings.filterableAttributes.includes(f))
        return err(400, 'invalid_search_facets', `${f} is not filterable`);
    let geoPoint: { lat: number; lng: number; dir: 1 | -1 } | null = null;
    const sorters: ((a: Doc, b: Doc) => number)[] = [];
    for (const s of (q.sort ?? []) as string[]) {
      const g = GEO_POINT.exec(s);
      if (g) {
        if (!settings.sortableAttributes.includes('_geo')) return err(400, 'invalid_search_sort');
        const point = { lat: Number(g[1]), lng: Number(g[2]), dir: g[3] === 'desc' ? -1 : 1 } as const;
        geoPoint = point;
        sorters.push((a, b) => {
          const da = a._geo ? geoDistanceM(point, a._geo as { lat: number; lng: number }) : Infinity;
          const db = b._geo ? geoDistanceM(point, b._geo as { lat: number; lng: number }) : Infinity;
          return da === db ? 0 : da < db ? -point.dir : point.dir;
        });
        continue;
      }
      const m = SORT.exec(s);
      if (!m || !settings.sortableAttributes.includes(m[1] ?? '')) return err(400, 'invalid_search_sort', s);
      const [, attr = '', dir] = m;
      const k = dir === 'desc' ? -1 : 1;
      sorters.push((a, b) => {
        const x = a[attr] as number | string;
        const y = b[attr] as number | string;
        return x === y ? 0 : x < y ? -k : k;
      });
    }
    const terms = words(String(q.q ?? ''));
    const searchable =
      settings.searchableAttributes[0] === '*' ? null : new Set(settings.searchableAttributes);
    const textMatch = (d: Doc) => {
      if (terms.length === 0) return true;
      const haystack = Object.entries(d)
        .filter(([k, v]) => typeof v === 'string' && (!searchable || searchable.has(k)))
        .flatMap(([, v]) => words(v as string));
      return terms.every((t) => haystack.some((w) => w.startsWith(t)));
    };
    const matched = [...documents.values()].filter((d) => textMatch(d) && preds.every((p) => p(d)));
    matched.sort((a, b) => {
      for (const s of sorters) {
        const r = s(a, b);
        if (r !== 0) return r;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const facetDistribution: Record<string, Record<string, number>> = {};
    for (const f of facets) {
      const counts: Record<string, number> = {};
      for (const d of matched) {
        const v = d[f];
        if (typeof v === 'string' && v !== '') counts[v] = (counts[v] ?? 0) + 1;
      }
      facetDistribution[f] = counts;
    }
    const page = Math.max(1, Number(q.page ?? 1));
    const per = Math.max(0, Number(q.hitsPerPage ?? 20));
    const hits = matched.slice((page - 1) * per, page * per).map((d) => {
      const out: Record<string, unknown> = { ...d };
      if (geoPoint && d._geo)
        out._geoDistance = Math.round(geoDistanceM(geoPoint, d._geo as { lat: number; lng: number }));
      return out;
    });
    return {
      indexUid: config.index,
      hits,
      query: q.q ?? '',
      page,
      hitsPerPage: per,
      totalHits: matched.length,
      totalPages: per === 0 ? 0 : Math.ceil(matched.length / per),
      ...(facets.length ? { facetDistribution } : {}),
    };
  }

  async function handle(method: string, url: URL, key: FakeMeilisearchCall['key'], body: unknown) {
    const path = url.pathname;
    const idx = `/indexes/${config.index}`;
    const admin = key === 'admin';
    if (method === 'POST' && path === '/multi-search') {
      if (key !== 'admin' && key !== 'search') return err(403, 'invalid_api_key');
      const queries = (body as { queries?: Record<string, unknown>[] })?.queries ?? [];
      const results: Record<string, unknown>[] = [];
      for (const q of queries) {
        const r = runQuery(q);
        if (r instanceof Response) return r;
        results.push(r);
      }
      return json(200, { results });
    }
    if (!admin)
      return err(
        key === 'none' ? 401 : 403,
        key === 'none' ? 'missing_authorization_header' : 'invalid_api_key',
      );
    if (method === 'GET' && path.startsWith('/tasks/'))
      return json(200, { uid: Number(path.slice(7)), status: 'succeeded' });
    if (method === 'GET' && path === idx)
      return exists ? json(200, { uid: config.index, primaryKey: 'id' }) : err(404, 'index_not_found');
    if (method === 'POST' && path === '/indexes') {
      exists = true;
      return task();
    }
    if (!exists) return err(404, 'index_not_found');
    if (method === 'PATCH' && path === `${idx}/settings`) {
      const s = body as Partial<Settings>;
      settings = {
        searchableAttributes: s.searchableAttributes ?? settings.searchableAttributes,
        filterableAttributes: s.filterableAttributes ?? settings.filterableAttributes,
        sortableAttributes: s.sortableAttributes ?? settings.sortableAttributes,
      };
      return task();
    }
    if (method === 'POST' && path === `${idx}/documents`) {
      if (!Array.isArray(body)) return err(400, 'malformed_payload');
      // Strict: a document outside the allowlist would be a leak, so it fails the write.
      const parsed = body.map((d) => SearchDocument.safeParse({ _geo: null, ...(d as object) }));
      if (parsed.some((p) => !p.success)) return err(400, 'invalid_document_fields');
      for (const d of body as Doc[]) documents.set(d.id, { ...d });
      return task();
    }
    if (method === 'POST' && path === `${idx}/documents/delete-batch`) {
      for (const id of (body ?? []) as string[]) documents.delete(id);
      return task();
    }
    if (method === 'DELETE' && path === `${idx}/documents`) {
      documents.clear();
      return task();
    }
    return err(404, 'not_found', `${method} ${path}`);
  }

  const fake: FakeMeilisearch = {
    config,
    calls,
    documents,
    loaded: false,
    exists: () => exists,
    reset() {
      calls.length = 0;
      documents.clear();
      exists = false;
      fake.loaded = false;
      settings = { searchableAttributes: ['*'], filterableAttributes: [], sortableAttributes: [] };
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      const key: FakeMeilisearchCall['key'] = !auth
        ? 'none'
        : auth === `Bearer ${config.adminKey}`
          ? 'admin'
          : auth === `Bearer ${config.searchKey}`
            ? 'search'
            : 'other';
      if (url.origin !== config.url) return err(404, 'unknown_host');
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      const res = await handle(method, url, key, body);
      calls.push({ method, path: url.pathname, status: res.status, key });
      return res;
    }) as typeof fetch,
  };
  return fake;
}
