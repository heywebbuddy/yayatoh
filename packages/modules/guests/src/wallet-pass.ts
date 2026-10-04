import type { GuestPassContent } from './domain/hub.ts';

/**
 * The guest wallet pass port (M4.7a). Apple Wallet needs the owner's Pass Type ID and signing
 * certificate, Google Wallet an issuer account (M1.5e2, owner inbox), so dev and CI use the fake
 * adapter, which records what it was asked and hands back a JSON stand-in for the pass. A real
 * adapter returns a signed `.pkpass` file (Apple) or a "save to wallet" link (Google).
 */
export const GUEST_PASS_PLATFORMS = ['apple', 'google'] as const;
export type GuestPassPlatform = (typeof GUEST_PASS_PLATFORMS)[number];

export interface GuestPassRequest {
  readonly platform: GuestPassPlatform;
  readonly content: GuestPassContent;
  /** What the pass's QR code opens: the party's hub (its own link; resetting the link kills it). */
  readonly barcode: string;
  /** The language the pass's labels are written in. */
  readonly locale: string;
  /** Labels in that language (the adapter never translates). */
  readonly labels: Readonly<Record<'party' | 'when' | 'place' | 'seats', string>>;
  /** `relevantAt` written out in the event's zone and that language. */
  readonly when: string;
}

export type GuestPassResult =
  | { readonly kind: 'file'; readonly contentType: string; readonly filename: string; readonly body: string }
  | { readonly kind: 'redirect'; readonly url: string }
  | { readonly kind: 'unavailable' };

export interface GuestPassProvider {
  readonly name: 'fake' | 'apple' | 'google';
  /** Issue (or re-issue: same serial, same pass) the party's pass for one platform. */
  issuePass(request: GuestPassRequest): Promise<GuestPassResult>;
}

export interface FakeGuestPass {
  readonly platform: GuestPassPlatform;
  readonly serial: string;
  readonly barcode: string;
}

/** The content type of the fake adapter's stand-in (never a real wallet format). */
export const FAKE_PASS_CONTENT_TYPE = 'application/vnd.yayatoh.fake-pass+json';

/** The fake adapter: keeps every issue in memory (tests read them) and returns a JSON stand-in. */
export function fakeGuestPassProvider(log: FakeGuestPass[] = []): GuestPassProvider & {
  readonly issued: FakeGuestPass[];
} {
  return {
    name: 'fake',
    issued: log,
    async issuePass(r) {
      log.push({ platform: r.platform, serial: r.content.serial, barcode: r.barcode });
      const c = r.content;
      const body = {
        fake: true,
        platform: r.platform,
        serialNumber: c.serial,
        locale: r.locale,
        title: c.eventName,
        relevantDate: c.relevantAt.toISOString(),
        expirationDate: c.expiresAt.toISOString(),
        fields: [
          { key: 'party', label: r.labels.party, value: c.partyName },
          { key: 'when', label: r.labels.when, value: r.when },
          ...(c.place ? [{ key: 'place', label: r.labels.place, value: c.place }] : []),
          ...(c.seats.length
            ? [
                {
                  key: 'seats',
                  label: r.labels.seats,
                  value: [
                    ...c.seats.map((s) => `${s.table} · ${s.seat}`),
                    ...(c.moreSeats ? [`+${c.moreSeats}`] : []),
                  ].join(', '),
                },
              ]
            : []),
        ],
        barcode: { format: 'qr', message: r.barcode },
      };
      return {
        kind: 'file',
        contentType: FAKE_PASS_CONTENT_TYPE,
        filename: `${c.serial}-${r.platform}.json`,
        body: `${JSON.stringify(body, null, 2)}\n`,
      };
    },
  };
}
