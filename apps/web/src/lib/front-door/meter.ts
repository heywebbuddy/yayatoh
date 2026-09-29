import type { FrontDoorNotFoundRow, FrontDoorStatRow } from '@yayatoh/platform';

/**
 * In-process front-door counters (M2.4a "watch"): requests, 404s, proxy errors and forwarding
 * latency per host × route × who served it, plus the 404 paths. Totals are flushed in one call
 * every few seconds (`FRONT_DOOR_FLUSH_MS`, default 5 s) instead of one write per request; a lost
 * batch (crash, failed write) only loses a few seconds of counts.
 */
export interface Hit {
  readonly host: string;
  readonly route: string;
  readonly servedBy: 'next' | 'legacy';
  /** The status the client got, when the front door knows it. */
  readonly status?: number;
  /** The front door answered 502/504 itself (legacy unreachable or too slow). */
  readonly proxyError?: boolean;
  readonly latencyMs?: number;
  /** For the 404 top list (no query). */
  readonly path?: string;
}

type Stat = { -readonly [K in keyof FrontDoorStatRow]: FrontDoorStatRow[K] };
const MAX_KEYS = 2000;

export class FrontDoorMeter {
  private stats = new Map<string, Stat>();
  private paths = new Map<string, FrontDoorNotFoundRow & { count: number }>();
  private last: number;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly write: (s: FrontDoorStatRow[], p: FrontDoorNotFoundRow[]) => Promise<void>,
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.last = now();
  }

  private stat(host: string, route: string, servedBy: 'next' | 'legacy'): Stat | null {
    const key = `${host}|${route}|${servedBy}`;
    let s = this.stats.get(key);
    if (!s) {
      if (this.stats.size >= MAX_KEYS) return null;
      s = {
        host,
        route,
        servedBy,
        requests: 0,
        notFound: 0,
        proxyErrors: 0,
        upstream5xx: 0,
        latencyCount: 0,
        latencyMsSum: 0,
        latencyMsMax: 0,
      };
      this.stats.set(key, s);
    }
    return s;
  }

  private path(host: string, path: string, servedBy: 'next' | 'legacy'): void {
    const p = path.split('?')[0]?.slice(0, 300) || '/';
    const key = `${host}|${p}|${servedBy}`;
    const row = this.paths.get(key);
    if (row) row.count += 1;
    else if (this.paths.size < MAX_KEYS) this.paths.set(key, { host, path: p, servedBy, count: 1 });
  }

  record(hit: Hit): void {
    const s = this.stat(hit.host, hit.route, hit.servedBy);
    if (!s) return;
    s.requests += 1;
    if (hit.status === 404) s.notFound += 1;
    if (hit.proxyError) s.proxyErrors += 1;
    else if (hit.status !== undefined && hit.status >= 500) s.upstream5xx += 1;
    if (hit.latencyMs !== undefined) {
      const ms = Math.max(0, Math.round(hit.latencyMs));
      s.latencyCount += 1;
      s.latencyMsSum += ms;
      s.latencyMsMax = Math.max(s.latencyMsMax, ms);
    }
    if (hit.status === 404 && hit.path) this.path(hit.host, hit.path, hit.servedBy);
  }

  /**
   * A 404 the new app rendered (a page that called notFound()): the request itself was already
   * counted by the proxy, so only the 404 and its path are added here.
   */
  notFound(host: string, route: string, path: string): void {
    const s = this.stat(host, route, 'next');
    if (s) s.notFound += 1;
    this.path(host, path, 'next');
  }

  /** Flush when the interval has passed; returns the write to wait on (or null). */
  maybeFlush(): Promise<void> | null {
    if (this.now() - this.last < this.intervalMs) return null;
    return this.flush();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.last = this.now();
    const stats = [...this.stats.values()];
    const paths = [...this.paths.values()];
    this.stats = new Map();
    this.paths = new Map();
    if (!stats.length && !paths.length) return Promise.resolve();
    this.flushing = this.write(stats, paths)
      .catch((err: unknown) => {
        console.error('front door: counters not recorded', err);
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }
}
