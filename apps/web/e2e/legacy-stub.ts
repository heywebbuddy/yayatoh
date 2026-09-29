/**
 * A local stand-in for the legacy Laravel origins (M2.4a front-door tests). Never the live site:
 * two ports, one per instance (yayatoh.com and abc.yayatoh.com), started by playwright.config.ts.
 *
 * Every response names the instance and echoes what arrived (method, path, the headers the front
 * door is responsible for, body size and SHA-256). A few paths behave like the cases the spike
 * must survive: cookies with a Domain, redirects to the origin's own host, slow answers, large
 * streams, gzip, 404 and 500. `GET /__stub/log` lists the paths each instance received.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';

const YAY_PORT = Number(process.env.LEGACY_STUB_PORT ?? 3390);
const ABC_PORT = YAY_PORT + 1;
const log: { instance: string; method: string; path: string; at: number }[] = [];

const ECHOED = [
  'cookie',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-for',
  'x-real-ip',
  'x-yayatoh-front-door',
  'x-evil',
  'connection',
  'keep-alive',
  'upgrade',
  'content-type',
  'user-agent',
];

function handler(instance: 'yay' | 'abc', port: number) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/__stub/log') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(log));
      return;
    }
    log.push({ instance, method: req.method ?? 'GET', path: `${url.pathname}${url.search}`, at: Date.now() });
    if (log.length > 5000) log.splice(0, log.length - 5000);

    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of req) {
      bytes += (chunk as Buffer).length;
      hash.update(chunk as Buffer);
    }
    const echo = {
      legacy: instance,
      method: req.method,
      path: url.pathname,
      search: url.search,
      host: req.headers.host,
      headers: Object.fromEntries(ECHOED.map((h) => [h, req.headers[h] ?? null])),
      bodyBytes: bytes,
      bodySha256: hash.digest('hex'),
    };
    const json = (status: number, extra: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', 'x-legacy-stub': instance, ...extra });
      res.end(JSON.stringify(echo));
    };

    const p = url.pathname;
    if (p === '/stub/set-cookie')
      return json(200, {
        'set-cookie': [
          'legacy_session=s3cret; Domain=.yayatoh.com; Path=/; HttpOnly; SameSite=Lax',
          'XSRF-TOKEN=tok; domain=yayatoh.com; Path=/',
          'yy.session=forged; Path=/; HttpOnly',
          '__Host-yy.session=forged; Path=/; Secure; HttpOnly',
        ],
      });
    if (p === '/stub/redirect')
      return json(302, { location: `http://127.0.0.1:${port}/stub/landed?from=legacy` });
    if (p === '/stub/slow') {
      await new Promise((r) => setTimeout(r, Number(url.searchParams.get('ms') ?? 1000)));
      return json(200);
    }
    if (p === '/stub/stream') {
      const mb = Number(url.searchParams.get('mb') ?? 1);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-legacy-stub': instance });
      const chunk = Buffer.alloc(64 * 1024, 120);
      let left = mb * 1024 * 1024;
      const pump = () => {
        while (left > 0) {
          const n = Math.min(left, chunk.length);
          left -= n;
          if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n)))
            return void res.once('drain', pump);
        }
        res.end();
      };
      pump();
      return;
    }
    if (p === '/stub/gzip') {
      const body = gzipSync(Buffer.from(`gzipped legacy ${instance} `.repeat(200)));
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-encoding': 'gzip',
        'content-length': String(body.length),
        'x-legacy-stub': instance,
      });
      res.end(body);
      return;
    }
    if (p === '/stub/500') return json(500);
    if (p === '/stub/echo') return json(200);
    if (p.startsWith('/missing')) return json(404);
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'x-legacy-stub': instance, 'content-type': 'text/html' });
      res.end();
      return;
    }
    // Page-like answers for everything else (so a browser shows which side served it).
    if ((req.headers.accept ?? '').includes('text/html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-legacy-stub': instance });
      res.end(
        `<!doctype html><html lang="en"><head><title>Legacy ${instance}</title></head><body><main><h1>Legacy ${instance} ${p}</h1></main></body></html>`,
      );
      return;
    }
    return json(200);
  };
}

createServer(handler('yay', YAY_PORT)).listen(YAY_PORT, '127.0.0.1');
createServer(handler('abc', ABC_PORT)).listen(ABC_PORT, '127.0.0.1');
// biome-ignore lint/suspicious/noConsole: the stub says where it listens
console.log(`legacy stub: yay on ${YAY_PORT}, abc on ${ABC_PORT}`);
