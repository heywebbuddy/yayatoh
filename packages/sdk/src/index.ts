import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './schema.ts';

export type { components, paths };
/** The /v1 resources, e.g. `Schemas['Event']`. */
export type Schemas = components['schemas'];

export const SDK_VERSION = '0.3.0';

export interface YayatohClientOptions {
  /** The server, without `/v1`: `https://api.yayatoh.com`, or `https://app.yayatoh.com/api`. */
  readonly baseUrl: string;
  /** An org API key (`yy_live_…`) or a session token, or a function returning the current one. */
  readonly token?: string | (() => string | undefined | Promise<string | undefined>);
  /** Sent as `X-Yayatoh-Client` for per-app telemetry, e.g. `ios/3.2.1`. Default `sdk-ts/<version>`. */
  readonly client?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export type YayatohClient = Client<paths>;

/** A typed client for every /v1 endpoint (openapi-fetch): `client.GET('/v1/orgs/{org}/events', …)`. */
export function createYayatohClient(opts: YayatohClientOptions): YayatohClient {
  const client = createClient<paths>({ baseUrl: opts.baseUrl.replace(/\/$/, ''), fetch: opts.fetch });
  client.use({
    async onRequest({ request }) {
      const token = typeof opts.token === 'function' ? await opts.token() : opts.token;
      if (token && !request.headers.has('authorization'))
        request.headers.set('authorization', `Bearer ${token}`);
      request.headers.set('x-yayatoh-client', opts.client ?? `sdk-ts/${SDK_VERSION}`);
      return request;
    },
  });
  return client;
}

/** An RFC 9457 problem from /v1, thrown by `unwrap`. `code` is stable; switch on it. */
export class YayatohApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Schemas['Problem'] | null;
  readonly requestId: string | null;
  readonly retryAfter: number | null;

  constructor(response: Response, problem: Schemas['Problem'] | null) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${response.status}`);
    this.name = 'YayatohApiError';
    this.status = response.status;
    this.code = problem?.code ?? 'internal';
    this.problem = problem;
    this.requestId = response.headers.get('x-request-id');
    const retry = response.headers.get('retry-after');
    this.retryAfter = retry ? Number(retry) : null;
  }
}

/** The data of a successful call, or a `YayatohApiError` with the problem details. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok || error !== undefined) {
    const problem =
      error && typeof error === 'object' && 'code' in error ? (error as Schemas['Problem']) : null;
    throw new YayatohApiError(response, problem);
  }
  return data as T;
}

/** Every item of a cursor-paginated list, fetching pages as you iterate. */
export async function* paginate<T>(
  page: (cursor: string | undefined) => Promise<{ data: T[]; nextCursor: string | null }>,
): AsyncGenerator<T> {
  let cursor: string | undefined;
  do {
    const p = await page(cursor);
    yield* p.data;
    cursor = p.nextCursor ?? undefined;
  } while (cursor);
}

/** A fresh Idempotency-Key. Reuse the same key when you retry the same write. */
export function idempotencyKey(): string {
  return crypto.randomUUID();
}
