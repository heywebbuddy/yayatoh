/**
 * A fake `/v1` for the Tickets tests: handlers by "METHOD /path" with `:param` segments, answers
 * problem+json the way the real server does, and records every call.
 */
import { json, pair, problem } from '../../../../packages/mobile-core/tests/helpers/fake-api';

export { json, pair, problem };

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly headers: Headers;
}

export type Handler = (call: Call, params: Record<string, string>) => unknown;

export interface FakeServer {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Call[];
  /** Replace or add the handler for `"GET /v1/me/tickets"`. */
  on(route: string, handler: Handler | Response | object): void;
  /** Calls whose route matches, e.g. `server.callsTo('GET /v1/me/tickets/:id')`. */
  callsTo(route: string): Call[];
  offline: boolean;
}

const matcher = (route: string) => {
  const [method, path] = route.split(' ') as [string, string];
  const names: string[] = [];
  const regex = new RegExp(
    `^${path.replace(/:([a-zA-Z]+)/g, (_m, name: string) => {
      names.push(name);
      return '([^/]+)';
    })}$`,
  );
  return { method, regex, names };
};

export function createServer(): FakeServer {
  const routes: {
    route: string;
    method: string;
    regex: RegExp;
    names: string[];
    handler: (c: Call, p: Record<string, string>) => Promise<Response>;
  }[] = [];
  const calls: Call[] = [];
  const server: FakeServer = {
    calls,
    offline: false,
    on(route, handler) {
      const m = matcher(route);
      const fn: (c: Call, p: Record<string, string>) => Promise<Response> =
        typeof handler === 'function'
          ? async (call, params) => {
              const out = await (handler as (c: Call, p: Record<string, string>) => unknown)(call, params);
              return out instanceof Response ? out : json(200, out);
            }
          : handler instanceof Response
            ? async () => handler.clone()
            : async () => json(200, handler);
      const existing = routes.findIndex((r) => r.route === route);
      const entry = { route, ...m, handler: fn };
      if (existing >= 0) routes[existing] = entry;
      else routes.push(entry);
    },
    callsTo(route) {
      const m = matcher(route);
      return calls.filter((c) => c.method === m.method && m.regex.test(c.path));
    },
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const path = url.pathname.replace(/^.*?(\/v1\/)/, '/v1/');
      const raw = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.clone().text();
      const call: Call = {
        method: request.method,
        path,
        query: url.searchParams,
        body: raw ? JSON.parse(raw) : undefined,
        headers: request.headers,
      };
      calls.push(call);
      // The request left the phone but no answer came back: the call is recorded, then it fails.
      if (server.offline) throw new TypeError('Network request failed');
      for (const r of routes) {
        if (r.method !== request.method) continue;
        const match = r.regex.exec(path);
        if (!match) continue;
        const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(match[i + 1] ?? '')]));
        return r.handler(call, params);
      }
      return problem(404, 'not_found');
    },
  };
  // Every app start reads the version gate; an unknown answer never blocks.
  server.on('GET /v1/mobile/config', () => problem(404, 'not_found'));
  return server;
}
