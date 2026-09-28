/**
 * US state calling-hour rules for text messages (M3.5a), as data. The federal TCPA window
 * (08:00–21:00 local, 47 CFR § 64.1200(c)(1)) is `quiet-hours.ts`; these state statutes are
 * narrower and apply on top of it to SMS and WhatsApp to a number (or address) in that state.
 *
 * Every row is **pending TCPA counsel** (docs/owner-inbox.md): the citations were current when
 * written, but statutes change and counsel confirms scope (marketing only, or every text) before
 * go-live. Until then the platform applies them to every non-urgent text, which only ever delays
 * a message, never drops it. Area codes must be re-checked against NANPA before go-live.
 */
export type UsState = 'CT' | 'FL' | 'MD' | 'OK' | 'TX' | 'WA';

/** Allowed sending window on the listed weekdays (0 = Sunday), local wall-clock `HH:mm`. */
export interface AllowedWindow {
  readonly days: readonly number[];
  readonly from: string;
  readonly until: string;
}

export interface StateRule {
  readonly state: UsState;
  readonly name: string;
  /** When texts may go out; any other time is quiet. */
  readonly allowed: readonly AllowedWindow[];
  /** IANA zones used when only the state is known (the rule applies in each). */
  readonly zones: readonly string[];
  readonly citation: string;
  readonly source: string;
  readonly status: 'pending_tcpa_counsel';
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const STATE_RULES: Readonly<Record<UsState, StateRule>> = {
  TX: {
    state: 'TX',
    name: 'Texas',
    // Mon–Sat 9 a.m.–9 p.m.; Sunday noon–9 p.m.
    allowed: [
      { days: [1, 2, 3, 4, 5, 6], from: '09:00', until: '21:00' },
      { days: [0], from: '12:00', until: '21:00' },
    ],
    zones: ['America/Chicago', 'America/Denver'],
    citation: 'Tex. Bus. & Com. Code § 301.051',
    source: 'https://statutes.capitol.texas.gov/Docs/BC/htm/BC.301.htm',
    status: 'pending_tcpa_counsel',
  },
  FL: {
    state: 'FL',
    name: 'Florida',
    allowed: [{ days: EVERY_DAY, from: '08:00', until: '20:00' }],
    zones: ['America/New_York', 'America/Chicago'],
    citation: 'Fla. Stat. § 501.616(6)(a) (Florida Telephone Solicitation Act, as amended 2021)',
    source: 'http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.616.html',
    status: 'pending_tcpa_counsel',
  },
  OK: {
    state: 'OK',
    name: 'Oklahoma',
    allowed: [{ days: EVERY_DAY, from: '08:00', until: '20:00' }],
    zones: ['America/Chicago'],
    citation: 'Okla. Stat. tit. 15, § 775C.4 (Oklahoma Telephone Solicitation Act of 2022)',
    source: 'https://www.oscn.net/applications/oscn/DeliverDocument.asp?CiteID=491690',
    status: 'pending_tcpa_counsel',
  },
  MD: {
    state: 'MD',
    name: 'Maryland',
    allowed: [{ days: EVERY_DAY, from: '08:00', until: '20:00' }],
    zones: ['America/New_York'],
    citation: 'Md. Code, Com. Law § 14-4503 (Stop the Spam Calls Act of 2023)',
    source: 'https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=14-4503',
    status: 'pending_tcpa_counsel',
  },
  WA: {
    state: 'WA',
    name: 'Washington',
    allowed: [{ days: EVERY_DAY, from: '08:00', until: '20:00' }],
    zones: ['America/Los_Angeles'],
    citation: 'RCW 80.36.390(2)',
    source: 'https://app.leg.wa.gov/RCW/default.aspx?cite=80.36.390',
    status: 'pending_tcpa_counsel',
  },
  CT: {
    state: 'CT',
    name: 'Connecticut',
    allowed: [{ days: EVERY_DAY, from: '09:00', until: '20:00' }],
    zones: ['America/New_York'],
    citation: 'Conn. Gen. Stat. § 42-288a (as amended by P.A. 23-98)',
    source: 'https://www.cga.ct.gov/current/pub/chap_743h.htm',
    status: 'pending_tcpa_counsel',
  },
};

/**
 * Area codes (NANP, +1) of the states above. A code that crosses a time-zone line lists every
 * zone it covers, and the rule must allow the send in all of them (the conservative reading).
 */
const AREA_CODES: Readonly<Record<UsState, Readonly<Record<string, readonly string[]>>>> = {
  TX: {
    ...Object.fromEntries(
      [
        '210', '214', '254', '281', '325', '346', '361', '409', '430', '432', '469', '512', '682', '713',
        '726', '737', '806', '817', '830', '832', '903', '936', '940', '945', '956', '972', '979',
      ].map((c) => [c, ['America/Chicago']]),
    ),
    '915': ['America/Denver'],
  },
  FL: {
    ...Object.fromEntries(
      [
        '239', '305', '321', '324', '352', '386', '407', '561', '645', '656', '689', '727', '754', '772',
        '786', '813', '863', '904', '941', '954',
      ].map((c) => [c, ['America/New_York']]),
    ),
    '850': ['America/New_York', 'America/Chicago'],
    '448': ['America/New_York', 'America/Chicago'],
  },
  OK: Object.fromEntries(['405', '539', '572', '580', '918'].map((c) => [c, ['America/Chicago']])),
  MD: Object.fromEntries(['227', '240', '301', '410', '443', '667'].map((c) => [c, ['America/New_York']])),
  WA: Object.fromEntries(['206', '253', '360', '425', '509', '564'].map((c) => [c, ['America/Los_Angeles']])),
  CT: Object.fromEntries(['203', '475', '860', '959'].map((c) => [c, ['America/New_York']])),
};

const BY_AREA_CODE = new Map<string, { state: UsState; zones: readonly string[] }>(
  (Object.entries(AREA_CODES) as [UsState, Record<string, readonly string[]>][]).flatMap(([state, codes]) =>
    Object.entries(codes).map(([code, zones]) => [code, { state, zones }] as const),
  ),
);

/** The state (and its zones) a +1 number's area code belongs to, when a rule exists for it. */
export function stateOfPhone(phone: string | null | undefined): { state: UsState; zones: readonly string[] } | null {
  const m = /^\+1([2-9][0-9]{2})[2-9][0-9]{6}$/.exec(phone ?? '');
  return m?.[1] ? (BY_AREA_CODE.get(m[1]) ?? null) : null;
}

/** `US-TX` (ISO 3166-2, from the contact's address) → `TX` when a rule exists. */
export function stateOfRegion(region: string | null | undefined): UsState | null {
  const m = /^US-([A-Z]{2})$/.exec(region ?? '');
  const s = m?.[1];
  return s && Object.hasOwn(STATE_RULES, s) ? (s as UsState) : null;
}

/**
 * The state rules that apply to a recipient, each with the zones to check it in: the phone's
 * area code and the address's state both count (a Texas number living in Florida gets both).
 * The federal window is checked separately in the recipient's own timezone (`quiet-hours.ts`).
 */
export function applicableStateRules(input: {
  phone?: string | null;
  region?: string | null;
}): Array<{ rule: StateRule; zones: readonly string[] }> {
  const out = new Map<UsState, Set<string>>();
  const add = (state: UsState, zones: readonly string[]) => {
    const set = out.get(state) ?? new Set<string>();
    for (const z of zones) set.add(z);
    out.set(state, set);
  };
  const byPhone = stateOfPhone(input.phone);
  if (byPhone) add(byPhone.state, byPhone.zones);
  const byRegion = stateOfRegion(input.region);
  if (byRegion) add(byRegion, STATE_RULES[byRegion].zones);
  return [...out].map(([state, zones]) => ({ rule: STATE_RULES[state], zones: [...zones] }));
}
