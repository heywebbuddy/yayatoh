import { render, screen } from '@testing-library/react-native';
import { memoryKeyValueStore, ThemeProvider } from '@yayatoh/mobile-core';
import { constant } from '@yayatoh/ui/tokens';
import QRCode from 'qrcode';
import { createFormatter } from 'use-intl';
import {
  formatDay,
  formatEventRange,
  formatMoment,
  formatMoney,
  safeZone,
  spellOut,
} from '../src/tickets/format';
import { groupByEvent, ticketEnd, ticketStart } from '../src/tickets/group';
import {
  clearPending,
  PENDING_KEY,
  PENDING_TTL_MS,
  rememberPending,
  takePending,
} from '../src/tickets/pending';
import { qrPath, TicketQr } from '../src/tickets/qr';
import { event, IDS, summary } from './helpers/tickets-fixtures';

/** The dark modules a path draws, as `x,y` keys (the quiet zone removed). */
function modulesOf(d: string, quiet = 4): Set<string> {
  const out = new Set<string>();
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < w; i++) out.add(`${x - quiet + i},${y - quiet}`);
  }
  return out;
}

describe('QR code', () => {
  const samples = [
    'YY1.SIGNED.CODE.0123456789',
    'A',
    // The length of a real yy1 code: Ed25519-signed compact binary in base32, QR version 7 at M.
    `YY1${'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(4)}`,
    'https://example.test/ü?x=1',
  ];
  it.each(samples)('draws exactly the modules of the encoder’s matrix for %s', (code) => {
    const { modules } = QRCode.create(code, { errorCorrectionLevel: 'M' });
    const expected = new Set<string>();
    for (let y = 0; y < modules.size; y++)
      for (let x = 0; x < modules.size; x++) if (modules.get(y, x)) expected.add(`${x},${y}`);
    const { size, d } = qrPath(code);
    expect(size).toBe(modules.size + 8);
    expect(modulesOf(d)).toEqual(expected);
  });

  it('uses error correction level M with a four-module quiet zone (ADR 0011)', () => {
    // Byte mode at level M holds 108 bytes in version 6 (41 modules) and 124 in version 7 (45).
    expect(qrPath('x'.repeat(100)).size).toBe(41 + 8);
    expect(qrPath('x'.repeat(110)).size).toBe(45 + 8);
  });

  it('is drawn black on white at both themes, whatever the app theme is', () => {
    for (const choice of ['light', 'dark'] as const) {
      const view = render(
        <ThemeProvider initialChoice={choice}>
          <TicketQr code="YY1.SIGNED.CODE.0123456789" size={240} label="Ticket QR code for Summer Night" />
        </ThemeProvider>,
      );
      const qr = screen.getByTestId('ticket-qr');
      expect(qr).toHaveStyle({ backgroundColor: constant.white, width: 240, height: 240 });
      expect(screen.getByRole('image', { name: 'Ticket QR code for Summer Night' })).toBeOnTheScreen();
      // react-native-svg turns a colour into its ARGB number: opaque black and opaque white.
      expect(JSON.stringify(screen.toJSON())).toContain('"fill":{"type":0,"payload":4278190080}');
      expect(JSON.stringify(screen.toJSON())).toContain('"fill":{"type":0,"payload":4294967295}');
      view.unmount();
    }
  });
});

describe('dates and money', () => {
  const en = createFormatter({ locale: 'en' });
  const sep = ' – ';
  it('shows a same-day event once, with the zone on the end time', () => {
    expect(
      formatEventRange(en, '2030-03-01T19:00:00Z', '2030-03-01T23:00:00Z', 'America/Chicago', sep),
    ).toMatch(/^Fri, Mar 1, 2030, 1:00 PM – 5:00 PM (CST|GMT-6)$/);
  });
  it('is the same wherever the phone is: the event’s zone decides, not the phone’s', () => {
    expect(formatEventRange(en, '2030-03-01T15:00:00Z', '2030-03-01T17:00:00Z', 'Asia/Tokyo', sep)).toMatch(
      /^Sat, Mar 2, 2030, 12:00 AM – 2:00 AM (GMT\+9|JST)$/,
    );
  });
  it('shows both days for an event that runs past midnight there', () => {
    expect(
      formatEventRange(en, '2030-03-01T22:00:00Z', '2030-03-02T04:00:00Z', 'America/Chicago', sep),
    ).toMatch(/^Fri, Mar 1, 2030, 4:00 PM – 10:00 PM (CST|GMT-6)$/);
    expect(
      formatEventRange(en, '2030-03-01T22:00:00Z', '2030-03-02T08:00:00Z', 'America/Chicago', sep),
    ).toMatch(/^Fri, Mar 1, 4:00 PM – Sat, Mar 2, 2:00 AM (CST|GMT-6)$/);
  });
  it('shows a single time when the end is missing or not after the start', () => {
    expect(
      formatEventRange(en, '2030-03-01T19:00:00Z', '2030-03-01T19:00:00Z', 'America/Chicago', sep),
    ).toMatch(/^Fri, Mar 1, 2030, 1:00 PM (CST|GMT-6)$/);
    expect(formatEventRange(en, '2030-03-01T19:00:00Z', 'garbage', 'America/Chicago', sep)).toMatch(
      /1:00 PM/,
    );
    expect(formatEventRange(en, 'garbage', 'garbage', 'America/Chicago', sep)).toBe('');
  });
  it('falls back to the phone’s zone for a zone the platform does not know', () => {
    expect(safeZone('Mars/Olympus')).toBeUndefined();
    expect(safeZone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(safeZone(null)).toBeUndefined();
    expect(formatEventRange(en, '2030-03-01T19:00:00Z', '2030-03-01T23:00:00Z', 'Mars/Olympus', sep)).toMatch(
      /2030/,
    );
    expect(formatMoment(en, '2030-03-01T19:00:00Z', 'Mars/Olympus')).toMatch(/2030/);
  });
  it('writes the day and a moment in the event’s zone', () => {
    expect(formatDay(en, '2030-03-02T04:00:00Z', 'America/Chicago')).toBe('Friday, March 1, 2030');
    expect(formatMoment(en, '2030-03-01T19:00:00Z', 'America/Chicago')).toBe('Mar 1, 2030, 1:00 PM');
  });
  it('writes amounts in minor units by the currency’s own digits and the language', () => {
    expect(formatMoney(en, 350, 'USD')).toBe('$3.50');
    expect(formatMoney(en, 1200, 'JPY')).toBe('¥1,200');
    expect(formatMoney(createFormatter({ locale: 'de' }), 1050, 'EUR').replace(/\u00a0/g, ' ')).toBe(
      '10,50 €',
    );
    expect(formatMoney(en, 1050, 'not-a-currency')).toBe('10.50 not-a-currency');
  });
  it('spells a code out one character at a time', () => {
    expect(spellOut('AB12CD')).toBe('A B 1 2 C D');
  });
});

describe('grouping', () => {
  it('groups tickets by event and date in the server’s order', () => {
    const a1 = summary({ id: IDS.t1 });
    const b = summary({ id: IDS.t3, event: event({ id: IDS.event2, name: 'Gala' }) });
    const a2 = summary({ id: IDS.t2 });
    const dated = summary({
      id: IDS.t4,
      date: { startsAt: '2030-03-02T19:00:00Z', endsAt: '2030-03-02T23:00:00Z' },
    });
    const groups = groupByEvent([a1, b, a2, dated]);
    expect(groups.map((g) => g.data.map((t) => t.id))).toEqual([[IDS.t1, IDS.t2], [IDS.t3], [IDS.t4]]);
    expect(groups[2]?.startsAt).toBe('2030-03-02T19:00:00Z');
    expect(ticketStart(dated)).toBe('2030-03-02T19:00:00Z');
    expect(ticketEnd(a1)).toBe(a1.event.endsAt);
    expect(groupByEvent([])).toEqual([]);
  });
});

describe('pending link', () => {
  it('is kept for one pick-up and then gone', async () => {
    const store = memoryKeyValueStore();
    await rememberPending(store, { kind: 'claim', token: 'abcdefgh12345' });
    expect(await takePending(store)).toEqual({ kind: 'claim', token: 'abcdefgh12345' });
    expect(await takePending(store)).toBeNull();
  });
  it('is forgotten after half an hour, so it never follows a different person who signs in later', async () => {
    const store = memoryKeyValueStore();
    await rememberPending(store, { kind: 'claim', token: 'abcdefgh12345' }, 1_000);
    expect(await takePending(store, 1_000 + PENDING_TTL_MS + 1)).toBeNull();
    expect(store.data.has(PENDING_KEY)).toBe(false);
    await rememberPending(store, { kind: 'claim', token: 'abcdefgh12345' }, 1_000);
    expect(await takePending(store, 1_000 + PENDING_TTL_MS)).toEqual({
      kind: 'claim',
      token: 'abcdefgh12345',
    });
  });
  it('ignores anything that is not a link we wrote', async () => {
    const store = memoryKeyValueStore();
    for (const raw of [
      'not json',
      '{"kind":"other","token":"abcdefgh12"}',
      '{"kind":"claim","token":"x y"}',
      '{"kind":"claim"}',
      '[]',
    ]) {
      await store.set(PENDING_KEY, raw);
      expect(await takePending(store)).toBeNull();
      expect(store.data.has(PENDING_KEY)).toBe(false);
    }
  });
  it('can be cleared', async () => {
    const store = memoryKeyValueStore();
    await rememberPending(store, { kind: 'link', token: 'abcdefgh12345' });
    await clearPending(store);
    expect(await takePending(store)).toBeNull();
  });
});
