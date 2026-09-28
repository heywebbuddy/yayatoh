import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Listener = (event: Record<string, unknown>) => void;

/** Load public/push-sw.js in a fake worker global and capture its listeners. */
function loadWorker() {
  const listeners = new Map<string, Listener>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const focused: string[] = [];
  const clients: Array<{ url: string; focus: () => Promise<void> }> = [];
  const self = {
    location: { origin: 'https://app.yayatoh.test' },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: () => undefined,
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => clients,
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  runInNewContext(readFileSync(join(import.meta.dirname, '../public/push-sw.js'), 'utf8'), { self, URL });
  const waits: Promise<unknown>[] = [];
  const fire = async (type: string, event: Record<string, unknown>) => {
    listeners.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { fire, shown, opened, focused, clients };
}

const pushEvent = (payload: unknown) => ({
  data: {
    json: () => {
      if (typeof payload === 'string') return JSON.parse(payload);
      return payload;
    },
  },
});

describe('push service worker', () => {
  it('shows the allowlisted notification, RTL when the payload says so', async () => {
    const w = loadWorker();
    await w.fire(
      'push',
      pushEvent({
        title: 'تحديث',
        body: 'نص',
        url: 'https://app.yayatoh.test/messages/abc',
        tag: 't1',
        lang: 'ar',
        dir: 'rtl',
        extra: 'ignored',
      }),
    );
    expect(w.shown).toEqual([
      {
        title: 'تحديث',
        options: {
          body: 'نص',
          tag: 't1',
          lang: 'ar',
          dir: 'rtl',
          data: { url: 'https://app.yayatoh.test/messages/abc' },
        },
      },
    ]);
  });

  it('ignores payloads without a title or that are not JSON; never links off-site', async () => {
    const w = loadWorker();
    await w.fire('push', pushEvent({ body: 'no title' }));
    await w.fire('push', pushEvent('not json'));
    await w.fire('push', { data: null });
    expect(w.shown).toHaveLength(0);
    await w.fire('push', pushEvent({ title: 'x'.repeat(300), url: 'https://evil.test/phish' }));
    expect(w.shown[0]?.title).toHaveLength(120);
    expect(w.shown[0]?.options.data).toEqual({ url: 'https://app.yayatoh.test/' });
  });

  it('a click opens the link, or focuses a tab already on it', async () => {
    const w = loadWorker();
    let closed = false;
    const click = (url: string) => ({
      notification: { data: { url }, close: () => (closed = true) },
    });
    await w.fire('notificationclick', click('https://app.yayatoh.test/orders/x'));
    expect(closed).toBe(true);
    expect(w.opened).toEqual(['https://app.yayatoh.test/orders/x']);
    await w.fire('notificationclick', click('javascript:alert(1)'));
    expect(w.opened.at(-1)).toBe('https://app.yayatoh.test/');
    let focusedTab = false;
    w.clients.push({
      url: 'https://app.yayatoh.test/orders/y',
      focus: async () => {
        focusedTab = true;
      },
    });
    await w.fire('notificationclick', click('https://app.yayatoh.test/orders/y'));
    expect(focusedTab).toBe(true);
    expect(w.opened).toHaveLength(2);
  });
});
