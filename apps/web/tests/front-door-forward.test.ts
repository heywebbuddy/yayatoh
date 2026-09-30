import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { type FrontDoorConfig, frontDoorConfig } from '@yayatoh/platform/front-door';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forwardToLegacy } from '../src/lib/front-door/forward.ts';

/** A stand-in legacy origin on a random local port. */
let server: Server;
let origin: string;
const seen: { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer }[] = [];

async function handle(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  seen.push({
    method: req.method ?? '',
    url: req.url ?? '',
    headers: req.headers,
    body: Buffer.concat(chunks),
  });
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/cookie') {
    res.writeHead(201, {
      'set-cookie': ['sess=1; Domain=.yayatoh.com; Path=/; HttpOnly', 'yy.session=forged; Path=/'],
      location: `${origin}/next?x=1`,
    });
    return res.end('made');
  }
  if (path === '/gzip') {
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' });
    return res.end(gzipSync(Buffer.from('hello from legacy')));
  }
  if (path === '/slow') {
    await new Promise((r) => setTimeout(r, 400));
    return res.end('late');
  }
  if (path === '/trickle') {
    // Headers at once, then a body slower than the header timeout: it must arrive whole.
    res.writeHead(200, { 'content-type': 'text/plain' });
    for (let i = 0; i < 5; i++) {
      res.write(`part${i};`);
      await new Promise((r) => setTimeout(r, 60));
    }
    return res.end();
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('missing');
}

beforeAll(async () => {
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const config = (over: Partial<FrontDoorConfig> = {}): FrontDoorConfig => ({
  ...frontDoorConfig({ LEGACY_ORIGIN_SECRET: 'origin-secret' }),
  timeoutMs: 1000,
  ...over,
});
const request = (path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) =>
  new NextRequest(`https://yayatoh.com${path}`, {
    ...init,
    headers: { host: 'yayatoh.com', ...(init.headers as Record<string, string>) },
  });
const go = (req: NextRequest, path: string, c = config()) =>
  forwardToLegacy(req, { origin, pathAndQuery: path, host: 'yayatoh.com' }, c);

describe('forwarding to legacy (M2.4a)', () => {
  it('keeps method, body and status; scopes cookies; points redirects at the public host', async () => {
    const body = Buffer.from('name=Ann&ticket=2');
    const f = await go(
      request('/cookie', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': String(body.length),
          cookie: 'laravel_session=abc; __Host-yy.session=new; NEXT_LOCALE=ar',
          'x-forwarded-host': 'evil.example',
          'x-real-ip': '198.51.100.7',
        },
      }),
      '/cookie?a=1',
    );
    expect(f.failure).toBeNull();
    expect(f.status).toBe(201);
    expect(await f.response?.text()).toBe('made');
    expect(f.response?.headers.getSetCookie()).toEqual(['sess=1; Path=/; HttpOnly']);
    expect(f.response?.headers.get('location')).toBe('https://yayatoh.com/next?x=1');
    expect(f.response?.headers.get('x-front-door')).toBe('legacy');
    const got = seen.at(-1);
    expect(got?.method).toBe('POST');
    expect(got?.url).toBe('/cookie?a=1');
    expect(got?.body.toString()).toBe('name=Ann&ticket=2');
    expect(got?.headers.cookie).toBe('laravel_session=abc');
    expect(got?.headers['x-forwarded-host']).toBe('yayatoh.com');
    expect(got?.headers['x-forwarded-proto']).toBe('https');
    expect(got?.headers['x-forwarded-for']).toBe('198.51.100.7');
    expect(got?.headers['x-yayatoh-front-door']).toBe('origin-secret');
  });

  it('passes a 404 through and decodes compressed bodies', async () => {
    const miss = await go(request('/nope'), '/nope');
    expect(miss.status).toBe(404);
    expect(await miss.response?.text()).toBe('missing');
    const gz = await go(request('/gzip'), '/gzip');
    expect(gz.response?.headers.has('content-encoding')).toBe(false);
    expect(await gz.response?.text()).toBe('hello from legacy');
  });

  it('bounds only the wait for headers: slow headers are a 504, a slow body still streams', async () => {
    const slow = await go(request('/slow'), '/slow', config({ timeoutMs: 100 }));
    expect(slow).toMatchObject({ response: null, status: 504, failure: 'timeout' });
    const trickle = await go(request('/trickle'), '/trickle', config({ timeoutMs: 100 }));
    expect(await trickle.response?.text()).toBe('part0;part1;part2;part3;part4;');
  });

  it('an unreachable origin is a 502', async () => {
    const f = await forwardToLegacy(
      request('/x'),
      { origin: 'http://127.0.0.1:9', pathAndQuery: '/x', host: 'yayatoh.com' },
      config(),
    );
    expect(f).toMatchObject({ response: null, status: 502, failure: 'unreachable' });
  });

  it('refuses bodies over the limit or cut short, instead of forwarding them incomplete', async () => {
    const small = config({ maxBody: 1024 * 1024 });
    const big = Buffer.alloc(1024 * 1024 + 1);
    const count = seen.length;
    const declared = await go(
      request('/up', { method: 'POST', body: big, headers: { 'content-length': String(big.length) } }),
      '/up',
      small,
    );
    expect(declared).toMatchObject({ status: 413, failure: 'too_large' });
    const short = await go(
      request('/up', { method: 'POST', body: Buffer.alloc(10), headers: { 'content-length': '20' } }),
      '/up',
      small,
    );
    expect(short).toMatchObject({ status: 413, failure: 'too_large' });
    const unsized = await go(
      request('/up', { method: 'POST', body: Buffer.alloc(1024 * 1024 - 1000) }),
      '/up',
      small,
    );
    expect(unsized).toMatchObject({ status: 413, failure: 'too_large' });
    expect(seen.length).toBe(count);
  });
});
