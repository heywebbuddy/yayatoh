/**
 * V8 facade twin diff harness (roadmap §7.6 "Testing" 1, M2.2c). The same masked MySQL snapshot
 * runs the legacy Laravel app (in `legacy-ref`) and, through this ELT, the new `/api/v2` facade;
 * the golden HARs are replayed against both and every response pair is compared **type-strictly**.
 * A difference is "explained" only by an entry of the quirks ledger (a path pattern and a reason).
 * The facade is not built yet (frozen contract, roadmap §8.3), so the V8 check reports `pending`;
 * this module is the comparison engine and HAR reader it will run.
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface Difference {
  readonly path: string;
  readonly kind: 'missing' | 'extra' | 'type' | 'value' | 'status';
  readonly legacy?: unknown;
  readonly facade?: unknown;
}

export interface Explanation {
  /** `$.data[*].id`-style pattern: `*` matches one array index or key. */
  readonly path: string;
  readonly kinds?: readonly Difference['kind'][];
  readonly reason: string;
}

const typeOf = (v: Json) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Type-strict structural diff: `1` vs `"1"` is a type difference, key order is ignored. */
export function diffJson(legacy: Json, facade: Json, path = '$'): Difference[] {
  const lt = typeOf(legacy);
  const ft = typeOf(facade);
  if (lt !== ft) return [{ path, kind: 'type', legacy, facade }];
  if (lt === 'array') {
    const a = legacy as Json[];
    const b = facade as Json[];
    const out: Difference[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= b.length) out.push({ path: `${path}[${i}]`, kind: 'missing', legacy: a[i] });
      else if (i >= a.length) out.push({ path: `${path}[${i}]`, kind: 'extra', facade: b[i] });
      else out.push(...diffJson(a[i] as Json, b[i] as Json, `${path}[${i}]`));
    }
    return out;
  }
  if (lt === 'object') {
    const a = legacy as Record<string, Json>;
    const b = facade as Record<string, Json>;
    const out: Difference[] = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = `${path}.${k}`;
      if (!(k in b)) out.push({ path: p, kind: 'missing', legacy: a[k] });
      else if (!(k in a)) out.push({ path: p, kind: 'extra', facade: b[k] });
      else out.push(...diffJson(a[k] as Json, b[k] as Json, p));
    }
    return out;
  }
  return legacy === facade ? [] : [{ path, kind: 'value', legacy, facade }];
}

const patternRe = (p: string) =>
  new RegExp(
    `^${p
      .replace(/[.+?^${}()|\\]/g, '\\$&')
      .replace(/\[\*\]/g, '\\[\\d+\\]')
      .replace(/\\\.\*/g, '\\.[^.\\[]+')}$`,
  );

/** Split differences into explained (by the quirks ledger) and unexplained. */
export function explain(diffs: readonly Difference[], ledger: readonly Explanation[]) {
  const rules = ledger.map((e) => ({ ...e, re: patternRe(e.path) }));
  const explained: (Difference & { reason: string })[] = [];
  const unexplained: Difference[] = [];
  for (const d of diffs) {
    const r = rules.find((x) => x.re.test(d.path) && (!x.kinds || x.kinds.includes(d.kind)));
    if (r) explained.push({ ...d, reason: r.reason });
    else unexplained.push(d);
  }
  return { explained, unexplained };
}

export interface HarExchange {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: Json | string | null;
}

/** The API exchanges of a HAR file (`/api/v2/…` only; JSON bodies parsed, others kept as text). */
export function readHar(har: {
  log: {
    entries: {
      request: { method: string; url: string };
      response: { status: number; content?: { text?: string; mimeType?: string } };
    }[];
  };
}): HarExchange[] {
  return har.log.entries
    .map((e) => {
      const url = new URL(e.request.url);
      const text = e.response.content?.text ?? null;
      let body: Json | string | null = text;
      if (text && /json/i.test(e.response.content?.mimeType ?? ''))
        try {
          body = JSON.parse(text) as Json;
        } catch {
          body = text;
        }
      return {
        method: e.request.method.toUpperCase(),
        path: url.pathname + url.search,
        status: e.response.status,
        body,
      };
    })
    .filter((x) => x.path.startsWith('/api/v2/'));
}

/** Compare one replayed exchange from the legacy app and the facade. */
export function diffExchange(legacy: HarExchange, facade: HarExchange): Difference[] {
  const out: Difference[] =
    legacy.status === facade.status
      ? []
      : [{ path: '$status', kind: 'status', legacy: legacy.status, facade: facade.status }];
  if (typeof legacy.body === 'string' || typeof facade.body === 'string')
    return legacy.body === facade.body
      ? out
      : [...out, { path: '$', kind: 'value', legacy: legacy.body, facade: facade.body }];
  return [...out, ...diffJson(legacy.body, facade.body)];
}

/** V8 status: the facade is not built (M2.x); the harness above is what the check will run. */
export const FACADE_STATUS = {
  built: false,
  reason:
    'The /api/v2 facade is not built yet (frozen contract; roadmap §7.6, §8.3). Harness ready: src/facade-diff.ts.',
} as const;
