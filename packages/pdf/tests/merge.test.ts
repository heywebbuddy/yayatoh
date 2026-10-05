import { describe, expect, it } from 'vitest';
import { gotenbergRenderer } from '../src/index.ts';

describe('Gotenberg merge (M5.5a batch PDFs)', () => {
  it('posts the parts in order, named so Gotenberg keeps that order', async () => {
    let seen: { url: string; names: string[] } | undefined;
    const r = gotenbergRenderer({
      url: 'http://gotenberg.internal:3000',
      fetch: (async (url: string, init: RequestInit) => {
        const files = (init.body as FormData).getAll('files') as File[];
        seen = { url, names: files.map((f) => f.name) };
        return new Response(new Uint8Array([37, 80, 68, 70]));
      }) as unknown as typeof fetch,
    });
    const parts = Array.from({ length: 12 }, (_, i) => new Uint8Array([i]));
    const out = await r.merge?.(parts);
    expect(new TextDecoder().decode(out)).toBe('%PDF');
    expect(seen?.url).toBe('http://gotenberg.internal:3000/forms/pdfengines/merge');
    expect(seen?.names).toEqual(parts.map((_, i) => `${String(i).padStart(6, '0')}.pdf`));
    expect([...(seen?.names ?? [])].sort()).toEqual(seen?.names);
  });

  it('reports a failed merge', async () => {
    const r = gotenbergRenderer({
      url: 'http://g:3000',
      fetch: (async () => new Response('bad', { status: 400 })) as unknown as typeof fetch,
    });
    await expect(r.merge?.([new Uint8Array([1])])).rejects.toThrow(/gotenberg merge: 400/);
  });
});

describe('Gotenberg render retries (cold Chromium)', () => {
  const ok = () => new Response(new Uint8Array([37, 80, 68, 70]));
  const busy = () => new Response('browser start already in progress', { status: 500 });

  it('waits out a slow first start: timeout, then "start in progress", then the PDF', async () => {
    const answers = [
      () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
      () => Promise.resolve(busy()),
      () => Promise.resolve(ok()),
    ];
    let calls = 0;
    const r = gotenbergRenderer({
      url: 'http://g:3000',
      retryDelaysMs: [0, 0],
      fetch: (async () => (answers[calls++] as () => Promise<Response>)()) as unknown as typeof fetch,
    });
    expect(new TextDecoder().decode(await r.render({ html: '<p>x</p>' }))).toBe('%PDF');
    expect(calls).toBe(3);
  });
});
