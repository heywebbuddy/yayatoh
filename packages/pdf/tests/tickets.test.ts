import { describe, expect, it } from 'vitest';
import { escapeHtml, gotenbergRenderer, qrPath, ticketsHtml } from '../src/index.ts';

const input = (over: Partial<Parameters<typeof ticketsHtml>[0]> = {}) => ({
  lang: 'ar',
  dir: 'rtl' as const,
  eventName: 'قمة القيادة',
  when: '14 أكتوبر 2027',
  where: 'Chicago',
  organizer: 'Lakeside Events',
  tickets: [
    {
      typeName: 'GA',
      serialLabel: 'No. 1',
      shortCode: '7K3M9QX2',
      holderName: 'Ada',
      code: 'YY1ABC',
      qrLabel: 'QR 1',
    },
    {
      typeName: 'GA',
      serialLabel: 'No. 2',
      shortCode: '8K3M9QX2',
      holderName: 'Ada',
      code: 'YY1DEF',
      qrLabel: 'QR 2',
    },
  ],
  labels: { code: 'Code', holder: 'Holder', footer: 'Show at the door' },
  ...over,
});

describe('ticket PDF template', () => {
  it('sets lang and dir and renders one page per ticket with its QR', () => {
    const out = ticketsHtml(input());
    expect(out).toMatch(/^<!doctype html>\n<html lang="ar" dir="rtl">/);
    expect(out.match(/<section class="ticket">/g)).toHaveLength(2);
    expect(out).toContain(qrPath('YY1ABC').d);
    expect(out).toContain('7K3M9QX2');
  });

  it('escapes every value: no markup injection from event or holder names', () => {
    const out = ticketsHtml(
      input({
        eventName: '<img src=x onerror=alert(1)>',
        organizer: '"><script>fetch("http://evil")</script>',
        tickets: [
          {
            typeName: '<b>',
            serialLabel: '1',
            shortCode: 'X',
            holderName: "O'Hara & <i>",
            code: 'YY1',
            qrLabel: 'QR',
          },
        ],
      }),
    );
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<b>');
    expect(out).toContain('O&#39;Hara &amp; &lt;i&gt;');
    expect(escapeHtml('"<>&\'')).toBe('&quot;&lt;&gt;&amp;&#39;');
  });

  it('references no remote assets', () => {
    expect(ticketsHtml(input())).not.toMatch(/(src|href)=|url\(|@import/);
  });

  it('the Gotenberg adapter posts tagged-PDF HTML and returns the bytes', async () => {
    let seen: FormData | undefined;
    const r = gotenbergRenderer({
      url: 'http://gotenberg.internal:3000',
      fetch: (async (url: string, init: RequestInit) => {
        expect(url).toBe('http://gotenberg.internal:3000/forms/chromium/convert/html');
        seen = init.body as FormData;
        return new Response(new Uint8Array([37, 80, 68, 70]));
      }) as unknown as typeof fetch,
    });
    const bytes = await r.render({ html: '<p>x</p>' });
    expect(new TextDecoder().decode(bytes)).toBe('%PDF');
    expect(seen?.get('generateTaggedPdf')).toBe('true');
    expect(seen?.get('files')).toBeInstanceOf(Blob);
  });
});
