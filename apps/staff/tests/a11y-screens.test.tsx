/**
 * The rendered accessibility audit of the Staff app (M7.X): every screen, in its main states, in
 * English and in Arabic (right to left), at the largest system font size (fontScale 2), on a phone
 * and (for the door tools) on an iPad.
 *
 * The rules live in `packages/mobile-core/tests/support/a11y-audit.ts`: every control has a role and
 * a spoken name, a 44 point target (hit slop counted), toggles say whether they are on, images are
 * described, nothing hides a control from screen readers, text can grow (no caps, no fixed heights)
 * and the screen scrolls. Scan verdicts are checked for more: words, a glyph, a sound and a haptic
 * for every verdict, never colour alone. This file owns the rendering: one scenario per state.
 *
 * Jest has no layout engine, so "fits at the largest size" is proven through its causes (see
 * `a11y-static.test.ts`); how it looks on a phone is a device pass (docs/specs/M7.X/a11y.md).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { type AppLocale, memoryKeyValueStore } from '@yayatoh/mobile-core';
import {
  type AuditOptions,
  announcements,
  auditTree,
  hasArabicLetters,
  hasPlaceholderLeak,
} from '@yayatoh/mobile-core/testing/a11y-audit';
import { YayatohApiError } from '@yayatoh/sdk';
import type { ReactElement } from 'react';
import { Dimensions, PixelRatio, StyleSheet } from 'react-native';
import EnrolScreen from '../src/app/enrol/index';
import EnrolScanScreen from '../src/app/enrol/scan';
import SelectScreen from '../src/app/select/index';
import ExhibitorSignIn from '../src/app/sign-in/exhibitor';
import SignInChooser from '../src/app/sign-in/index';
import OrganizerSignIn from '../src/app/sign-in/organizer';
import { ENDED_KEY } from '../src/device/session';
import { catalogs } from '../src/i18n';
import { createFeedback } from '../src/scan/feedback';
import type { createScheduler } from '../src/scan/scheduler';
import { QrCamera } from '../src/scan/ui/qr-camera';
import { ScanView } from '../src/scan/ui/scan-screen';
import { VerdictPanel } from '../src/scan/ui/verdict-panel';
import { ALL_VERDICTS, viewFor } from '../src/scan/verdicts';
import { AssistanceScreen } from '../src/tools/screens/assistance';
import { GuestsScreen } from '../src/tools/screens/guests';
import { HubScreen } from '../src/tools/screens/hub';
import { LeadDetailScreen, LeadScanScreen, LeadsScreen } from '../src/tools/screens/leads';
import { LookupScreen } from '../src/tools/screens/lookup';
import { OpsScreen } from '../src/tools/screens/ops';
import { TodayScreen } from '../src/tools/screens/today';
import { Splash } from '../src/ui/splash';
import { auth, authHandler } from './helpers/auth-mock';
import { camera as enrolCamera, resetCamera } from './helpers/camera-mock';
import { CHECKPOINTS, EVENT_ID, enrolLink, json, OTHER_TOKEN } from './helpers/fake-door';
import { portal, portalHandler } from './helpers/portal-mock';
import { type App, buildApp, renderApp, settle } from './helpers/render';
import { resetRouter } from './helpers/router-mock';
import { camera } from './mocks/vision-camera';
import { FakeServer, header, NORTH, NOW, rig, row } from './scan/harness';
import { renderIn } from './scan/ui-helpers';
import {
  fakeOps,
  fakePortal,
  fakeStaff,
  lead,
  opsView,
  overview,
  request,
  SALT,
  setup,
  snapshot,
  row as toolRow,
} from './tools/fixtures';
import { makeDeps, offlineSwitch, renderTool } from './tools/harness';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-camera', () => require('./helpers/camera-mock'));
jest.mock('react-native-vision-camera', () => require('./mocks/vision-camera'));

let mockWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 3, fontScale: 2 }),
}));

const FONT_SCALE = 2;
const LOCALES = ['en', 'ar'] as const satisfies readonly AppLocale[];
type Locale = (typeof LOCALES)[number];

interface Ctx {
  readonly locale: Locale;
  /** A string of the app's catalog in the language being audited. */
  readonly t: (path: string) => string;
}

interface Scenario {
  readonly name: string;
  /** Renders the screen in the state, and waits until it shows. */
  readonly run: (ctx: Ctx) => Promise<void>;
  /** Texts that must be announced to a screen reader (an alert or a live region). */
  readonly announces?: (ctx: Ctx) => readonly string[];
  /** Why this state has no heading, if it has none. */
  readonly noHeader?: string;
  /** The controls are named after people's data, so they need not be Arabic. */
  readonly dataLabels?: string;
  readonly audit?: AuditOptions;
  /** Why this state has nothing to press (a loading or a plain notice). */
  readonly noControls?: string;
}

const lookup = (locale: Locale, path: string): string => {
  const value = path
    .split('.')
    .reduce<unknown>((tree, key) => (tree as Record<string, unknown> | undefined)?.[key], catalogs[locale]);
  if (typeof value !== 'string') throw new Error(`No string at ${path} in ${locale}`);
  return value;
};

const tap = async (testID: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
  await settle();
};
const typeInto = (testID: string, text: string) => fireEvent.changeText(screen.getByTestId(testID), text);
const never = () => new Promise<never>(() => {});

beforeAll(() => {
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(FONT_SCALE);
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: FONT_SCALE },
    screen: { width: 390, height: 844, scale: 3, fontScale: FONT_SCALE },
  });
});
beforeEach(() => {
  mockWidth = 390;
  resetRouter();
  resetCamera();
  camera.reset();
});

// --- the app's own screens (enrolment, sign-in, picker) -----------------------------------------

const app = (ctx: Ctx, over: { storage?: ReturnType<typeof memoryKeyValueStore> } = {}): App =>
  buildApp({ locale: ctx.locale, ...over });

async function enrolled(ctx: Ctx): Promise<App> {
  const a = app(ctx);
  await a.device.enrol(enrolLink());
  await a.device.heartbeat();
  a.device.stopHeartbeat();
  return a;
}

const screens: Scenario[] = [
  {
    name: 'starting up',
    run: async (ctx) => {
      await renderApp(<Splash />, app(ctx));
      await screen.findByTestId('home-card');
    },
    noControls: 'A splash while the stored enrolment is read',
  },
  {
    name: 'enrolment',
    run: async (ctx) => {
      await renderApp(<EnrolScreen />, app(ctx));
      await screen.findByTestId('enrol-screen');
    },
  },
  {
    name: 'enrolment, a link that is not one',
    run: async (ctx) => {
      await renderApp(<EnrolScreen />, app(ctx));
      typeInto('enrol-link', 'https://example.org/hello');
      await tap('enrol-submit');
      await screen.findByTestId('enrol-error');
    },
    announces: (ctx) => [ctx.t('enrol.errors.invalid_link')],
  },
  ...(['revoked', 'wiped'] as const).map((status) => ({
    name: `enrolment, device ${status}`,
    run: async (ctx: Ctx) => {
      const storage = memoryKeyValueStore({
        'yayatoh.pref.locale': ctx.locale,
        [ENDED_KEY]: JSON.stringify({ status, wipeDone: true }),
      });
      await renderApp(<EnrolScreen />, app(ctx, { storage }));
      await screen.findByTestId('enrol-ended');
    },
    announces: (ctx: Ctx) => [ctx.t(`enrol.notices.${status}`)],
  })),
  {
    name: 'enrolment, replacing another event',
    run: async (ctx) => {
      const a = await enrolled(ctx);
      a.door.valid.add(OTHER_TOKEN);
      await renderApp(<EnrolScreen />, a);
      typeInto('enrol-link', enrolLink(OTHER_TOKEN));
      await tap('enrol-submit');
      await screen.findByTestId('enrol-replace');
    },
  },
  {
    name: 'enrolment, the camera',
    run: async (ctx) => {
      await renderApp(<EnrolScanScreen />, app(ctx));
      await screen.findByTestId('camera-view');
    },
    audit: { fixedLayout: 'A full-screen camera' },
  },
  {
    name: 'enrolment, the camera was refused',
    run: async (ctx) => {
      enrolCamera.permission = { granted: false, canAskAgain: false };
      await renderApp(<EnrolScanScreen />, app(ctx));
      await settle();
    },
    audit: { fixedLayout: 'A permission page' },
  },
  {
    name: 'enrolment, a code that is not an enrolment code',
    run: async (ctx) => {
      await renderApp(<EnrolScanScreen />, app(ctx));
      await act(async () => {
        enrolCamera.onBarcodeScanned?.({ data: 'https://example.org/menu' });
      });
      await screen.findByTestId('scan-not-enrolment');
    },
    announces: (ctx) => [ctx.t('enrol.scanner.invalid')],
    audit: { fixedLayout: 'A full-screen camera' },
  },
  {
    name: 'sign-in chooser',
    run: async (ctx) => {
      await renderApp(<SignInChooser />, app(ctx));
      await screen.findByTestId('sign-in-chooser');
    },
  },
  {
    name: 'organizer sign-in, email and password',
    run: async (ctx) => {
      const a = app(ctx);
      a.extra.handler = (req) => authHandler(auth(), req);
      await renderApp(<OrganizerSignIn />, a);
      await screen.findByTestId('organizer-email');
    },
  },
  {
    name: 'organizer sign-in, a wrong email',
    run: async (ctx) => {
      const a = app(ctx);
      a.extra.handler = (req) => authHandler(auth(), req);
      await renderApp(<OrganizerSignIn />, a);
      typeInto('organizer-email', 'not an email');
      typeInto('organizer-password', 'x');
      await tap('organizer-continue');
      await screen.findByTestId('organizer-email-error');
    },
    announces: (ctx) => [ctx.t('organizer.errors.emailInvalid')],
  },
  {
    name: 'organizer sign-in, the code',
    run: async (ctx) => {
      const a = app(ctx);
      a.extra.handler = (req) => authHandler(auth(), req);
      await renderApp(<OrganizerSignIn />, a);
      typeInto('organizer-email', 'omar@yayatoh.test');
      typeInto('organizer-password', 'correct horse');
      await tap('organizer-continue');
      await screen.findByTestId('organizer-code');
    },
  },
  {
    name: 'organizer sign-in, a code left empty',
    run: async (ctx) => {
      const a = app(ctx);
      a.extra.handler = (req) => authHandler(auth(), req);
      await renderApp(<OrganizerSignIn />, a);
      typeInto('organizer-email', 'omar@yayatoh.test');
      typeInto('organizer-password', 'correct horse');
      await tap('organizer-continue');
      await tap('organizer-verify');
      await screen.findByTestId('organizer-code-error');
    },
    announces: (ctx) => [ctx.t('organizer.errors.codeRequired')],
  },
  {
    name: 'exhibitor sign-in, the invitation',
    run: async (ctx) => {
      const a = app(ctx);
      a.extra.handler = (req) => portalHandler(portal(), req);
      await renderApp(<ExhibitorSignIn />, a);
      await screen.findByTestId('exhibitor-invite');
    },
  },
  {
    name: 'exhibitor sign-in, something that is not an invitation',
    run: async (ctx) => {
      const a = app(ctx);
      a.extra.handler = (req) => portalHandler(portal(), req);
      await renderApp(<ExhibitorSignIn />, a);
      typeInto('exhibitor-invite', 'hello');
      await tap('exhibitor-send');
      await screen.findByTestId('exhibitor-invite-error');
    },
  },
  {
    name: 'exhibitor sign-in, the code',
    run: async (ctx) => {
      const a = app(ctx);
      a.extra.handler = (req) => portalHandler(portal(), req);
      await renderApp(<ExhibitorSignIn />, a);
      typeInto('exhibitor-invite', 'inv'.padEnd(43, 'A1b2C3d4E5'));
      await tap('exhibitor-send');
      await screen.findByTestId('exhibitor-code');
    },
  },
  {
    name: 'exhibitor sign-in, a code that is too short',
    run: async (ctx) => {
      const a = app(ctx);
      a.extra.handler = (req) => portalHandler(portal(), req);
      await renderApp(<ExhibitorSignIn />, a);
      typeInto('exhibitor-invite', 'inv'.padEnd(43, 'A1b2C3d4E5'));
      await tap('exhibitor-send');
      typeInto('exhibitor-code', '12');
      await tap('exhibitor-verify');
      await screen.findByTestId('exhibitor-code-error');
    },
    announces: (ctx) => [ctx.t('exhibitor.errors.codeInvalid')],
  },
  {
    name: 'picker, event and places',
    run: async (ctx) => {
      await renderApp(<SelectScreen />, await enrolled(ctx));
      await screen.findByTestId('select-whole-event');
    },
  },
  {
    name: 'picker, a place chosen',
    run: async (ctx) => {
      const a = await enrolled(ctx);
      await a.device.selectCheckpoint(CHECKPOINTS[0]?.id ?? null);
      await renderApp(<SelectScreen />, a);
      await screen.findByTestId('select-continue');
    },
  },
  {
    name: 'picker, the places could not be loaded',
    run: async (ctx) => {
      const a = app(ctx);
      const original = a.door.fetch;
      a.door.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('/manifest')) throw new TypeError('offline');
        return original(input, init);
      };
      await a.device.enrol(enrolLink());
      a.device.stopHeartbeat();
      await renderApp(<SelectScreen />, a);
      await screen.findByTestId('select-unavailable');
    },
    announces: (ctx) => [ctx.t('device.select.unavailable')],
  },
  {
    name: 'picker, the device may not scan there',
    run: async (ctx) => {
      const a = await enrolled(ctx);
      jest.spyOn(a.device, 'selectCheckpoint').mockResolvedValue(false);
      await renderApp(<SelectScreen />, a);
      await tap('select-whole-event');
      await screen.findByTestId('select-refused');
    },
    announces: (ctx) => [ctx.t('device.select.refused')],
  },
  {
    name: 'picker, asking before removing the device',
    run: async (ctx) => {
      await renderApp(<SelectScreen />, await enrolled(ctx));
      await tap('select-remove');
      await screen.findByTestId('select-remove-confirm');
    },
  },
];

// --- the scan screen -----------------------------------------------------------------------------

const atServerTime = Date.parse('2027-12-01T12:00:00Z');

async function scanRig(over: { rows?: ReturnType<typeof row>[]; checkpoint?: string | null } = {}) {
  const server = new FakeServer({ header: await header(), rows: over.rows ?? [row(1), row(2), row(3)] });
  const r = await rig(server, { at: atServerTime });
  await r.engine.sync();
  r.clock.ms = Date.parse(NOW);
  r.engine.setCheckpoint(over.checkpoint === undefined ? NORTH : over.checkpoint);
  return { ...r, server };
}

async function scanView(ctx: Ctx, engine: Awaited<ReturnType<typeof scanRig>>['engine'], now?: () => number) {
  const view = renderIn(
    <ScanView
      engine={engine}
      scheduler={null as ReturnType<typeof createScheduler> | null}
      feedback={{ play: () => {} }}
      {...(now ? { now } : {})}
    />,
    ctx.locale,
  );
  await act(async () => {});
  return view;
}

const scan: Scenario[] = [
  {
    name: 'scan, ready',
    run: async (ctx) => {
      const { engine } = await scanRig();
      await scanView(ctx, engine);
      await screen.findByTestId('verdict-idle');
    },
  },
  {
    name: 'scan, whole event with direction switch',
    run: async (ctx) => {
      const { engine } = await scanRig({ checkpoint: null });
      await scanView(ctx, engine);
      await screen.findByTestId('verdict-idle');
    },
  },
  ...(
    [
      ['admit', (n: number) => row(n)],
      ['duplicate', (n: number) => row(n)],
      ['void', (n: number) => row(n, { status: 'void' })],
    ] as const
  ).map(([verdict, make]) => ({
    name: `scan, verdict ${verdict}`,
    run: async (ctx: Ctx) => {
      const { engine } = await scanRig({ rows: [make(1)] });
      let clock = 0;
      await scanView(ctx, engine, () => clock);
      await act(async () => camera.see(row(1).shortCode));
      if (verdict === 'duplicate') {
        clock += 60_000;
        await act(async () => camera.see(`${row(1).shortCode} `));
      }
      await screen.findByTestId('verdict-panel');
    },
    announces: (ctx: Ctx) => [ctx.t(`scan.verdict.${verdict}.title`)],
  })),
  {
    name: 'scan, typing a code by hand',
    run: async (ctx) => {
      const { engine } = await scanRig();
      await scanView(ctx, engine);
      await tap('manual-open');
      await screen.findByTestId('manual-entry');
    },
  },
  {
    name: 'scan, an empty code typed',
    run: async (ctx) => {
      const { engine } = await scanRig();
      await scanView(ctx, engine);
      await tap('manual-open');
      await tap('manual-submit');
      await screen.findByTestId('manual-error');
    },
    announces: (ctx) => [ctx.t('scan.manual.empty')],
  },
  {
    name: 'scan, camera not yet allowed',
    run: async (ctx) => {
      camera.permission = 'not-determined';
      const { engine } = await scanRig();
      await scanView(ctx, engine);
      await screen.findByTestId('camera-ask');
    },
  },
  {
    name: 'scan, camera refused',
    run: async (ctx) => {
      camera.permission = 'denied';
      const { engine } = await scanRig();
      await scanView(ctx, engine);
      await screen.findByTestId('camera-denied');
    },
  },
  {
    name: 'scan, no camera on this phone',
    run: async (ctx) => {
      camera.device = undefined;
      const { engine } = await scanRig();
      await scanView(ctx, engine);
      await screen.findByTestId('camera-unavailable');
    },
  },
  {
    name: 'scan, the list is not on the phone yet',
    run: async (ctx) => {
      const server = new FakeServer({ header: await header(), rows: [] });
      const r = await rig(server, { at: atServerTime });
      await scanView(ctx, r.engine);
      await screen.findByTestId('scan-download');
    },
  },
];

// --- the verdicts: words, a glyph, a sound and a haptic, never colour alone ----------------------

describe('every scan verdict says it four ways', () => {
  const tones = new Map<string, Set<string>>();
  for (const id of ALL_VERDICTS) {
    const view = viewFor(id);
    const set = tones.get(view.tone) ?? new Set<string>();
    set.add(`${view.sound}/${view.haptic}`);
    tones.set(view.tone, set);
  }

  it('gives each tone its own sound and its own haptic, so the three can be told apart without looking', () => {
    const all = [...tones.values()].flatMap((set) => [...set]);
    expect(new Set(all).size).toBe(all.length);
    expect([...tones.keys()].sort()).toEqual(['admit', 'stop', 'warn']);
    for (const id of ALL_VERDICTS) {
      expect(viewFor(id).sound).toBeTruthy();
      expect(viewFor(id).haptic).toBeTruthy();
    }
  });

  it.each(LOCALES)('plays a sound and a haptic for every verdict, and writes the verdict in %s', (locale) => {
    const sound = jest.fn();
    const haptic = jest.fn();
    const feedback = createFeedback({ sound, haptic });
    for (const id of ALL_VERDICTS) {
      const view = viewFor(id);
      feedback.play(view);
      expect(sound).toHaveBeenLastCalledWith(view.sound);
      expect(haptic).toHaveBeenLastCalledWith(view.haptic);
      expect(lookup(locale, `scan.verdict.${view.key}.title`).trim()).not.toBe('');
    }
    expect(sound).toHaveBeenCalledTimes(ALL_VERDICTS.length);
    expect(haptic).toHaveBeenCalledTimes(ALL_VERDICTS.length);
  });

  it.each(LOCALES)('shows every verdict as words and a glyph, announced at once, in %s', (locale) => {
    for (const id of ALL_VERDICTS) {
      const { unmount } = renderIn(
        <VerdictPanel
          outcome={{
            scanId: 's1',
            verdict: id,
            ticketId: 't1',
            holderName: 'Ada Lovelace',
            typeName: 'General',
            firstAdmission: { at: '2027-12-01T19:00:00Z', checkpointName: 'North gate' },
            elapsedMs: 12,
          }}
          timezone="UTC"
        />,
        locale,
      );
      const view = viewFor(id);
      const panel = screen.getByTestId('verdict-panel');
      expect(panel.props.accessibilityLiveRegion).toBe('assertive');
      expect(panel.props.accessibilityRole).toBe('alert');
      expect(panel.props.accessibilityLabel).toContain(lookup(locale, `scan.verdict.${view.key}.title`));
      expect(screen.getByTestId(`verdict-glyph-${view.tone}`)).toBeOnTheScreen();
      unmount();
    }
  });

  it('uses a different glyph for each tone', () => {
    renderIn(<VerdictPanel outcome={null} timezone={null} />);
    const glyphs = new Set<string>();
    for (const tone of ['admit', 'warn', 'stop'] as const) {
      const id = ALL_VERDICTS.find((v) => viewFor(v).tone === tone);
      if (!id) throw new Error(`no verdict with the tone ${tone}`);
      const { unmount } = renderIn(
        <VerdictPanel
          outcome={{
            scanId: 's',
            verdict: id,
            ticketId: null,
            holderName: null,
            typeName: null,
            firstAdmission: null,
            elapsedMs: 1,
          }}
          timezone={null}
        />,
      );
      const text = screen.getByTestId(`verdict-glyph-${tone}`).props.children;
      glyphs.add(String(text));
      unmount();
    }
    expect(glyphs.size).toBe(3);
  });
});

// --- the door tools ------------------------------------------------------------------------------

const choice = { org: 'harbor', orgName: 'Harbor Events', eventId: EVENT_ID, eventName: 'Harbor Summit' };
const organizer = (api = fakeOps(), c: typeof choice | null = choice) => ({
  api,
  choice: c,
  choose: jest.fn(),
});
const rep = (api = fakePortal(), sessionKey = 'session-1') => ({ api, sessionKey });
const tool = (ctx: Ctx, ui: ReactElement, deps = makeDeps()) => renderTool(ui, { deps, locale: ctx.locale });

async function savedManifest() {
  return {
    salt: SALT,
    origin: 'device' as const,
    rows: [
      await toolRow({
        ticketId: 't1',
        shortCode: 'ADA00001',
        holderName: 'Ada Lovelace',
        email: 'ada@example.test',
      }),
      await toolRow({ ticketId: 't2', shortCode: 'VOID0002', holderName: 'Adele Goldberg', status: 'void' }),
    ],
    admittedToday: (id: string) => id === 'none',
  };
}

const Camera = ({ onCode }: { onCode: (code: string) => void }) => {
  const { Pressable, Text } = require('react-native');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Read badge"
      onPress={() => onCode('BADGE-CAM')}
      style={{ minHeight: 44 }}
      testID="camera"
    >
      <Text>Read badge</Text>
    </Pressable>
  );
};

const tools: Scenario[] = [
  {
    name: 'tools home, door device',
    run: async (ctx) => {
      tool(ctx, <HubScreen />);
      await screen.findByTestId('tile-lookup');
    },
  },
  {
    name: 'tools home, exhibitor and organizer',
    run: async (ctx) => {
      tool(
        ctx,
        <HubScreen />,
        makeDeps({ device: null, staff: null, portal: rep(), organizer: organizer() }),
      );
      await screen.findByTestId('tile-leads');
    },
  },
  {
    name: 'tools home, no role yet',
    run: async (ctx) => {
      tool(ctx, <HubScreen />, makeDeps({ device: null, staff: null }));
      await screen.findByText(ctx.t('tools.hub.none'));
    },
    noControls: 'Says what to do first; the way there is the start screen',
  },
  {
    name: 'guest lookup, list saved on the phone',
    run: async (ctx) => {
      const src = await savedManifest();
      tool(ctx, <LookupScreen />, makeDeps({ manifest: async () => src }));
      await screen.findByTestId('lookup-query');
    },
  },
  {
    name: 'guest lookup, results',
    run: async (ctx) => {
      const src = await savedManifest();
      tool(ctx, <LookupScreen />, makeDeps({ manifest: async () => src }));
      await screen.findByText(ctx.t('tools.lookup.sourceDevice'));
      typeInto('lookup-query', 'ada love');
      await tap('lookup-search');
      await screen.findByText('Ada Lovelace');
    },
  },
  {
    name: 'guest lookup, too few letters',
    run: async (ctx) => {
      const src = await savedManifest();
      tool(ctx, <LookupScreen />, makeDeps({ manifest: async () => src }));
      await screen.findByText(ctx.t('tools.lookup.sourceDevice'));
      typeInto('lookup-query', 'a');
      await tap('lookup-search');
      await screen.findByText(new RegExp(ctx.t('tools.lookup.tooShort').slice(0, 8)));
    },
    announces: (ctx) => [ctx.t('tools.lookup.tooShort')],
  },
  {
    name: 'guest lookup, offline with nothing saved',
    run: async (ctx) => {
      tool(ctx, <LookupScreen />, makeDeps({ useOffline: () => true }));
      await screen.findByText(ctx.t('tools.lookup.unavailable'));
    },
  },
  {
    name: 'guest lookup, checking a guest in',
    run: async (ctx) => {
      const src = await savedManifest();
      tool(ctx, <LookupScreen />, makeDeps({ manifest: async () => src }));
      await screen.findByText(ctx.t('tools.lookup.sourceDevice'));
      typeInto('lookup-query', 'ada love');
      await tap('lookup-search');
      await screen.findByText('Ada Lovelace');
      const open = screen.getAllByRole('button').find((b) => /check/i.test(String(b.props.testID)));
      if (open) await act(async () => void fireEvent.press(open));
    },
    dataLabels: 'Buttons name the guest',
  },
  {
    name: 'guest list, ask for a search',
    run: async (ctx) => {
      tool(ctx, <GuestsScreen />);
      await screen.findByText(ctx.t('tools.guests.prompt'));
    },
  },
  {
    name: 'guest list, results',
    run: async (ctx) => {
      tool(ctx, <GuestsScreen />);
      await act(async () => {
        fireEvent.changeText(await screen.findByTestId('guests-query'), 'hopper');
      });
      await screen.findByText('Hopper wedding');
    },
    dataLabels: 'Buttons name the guest',
  },
  {
    name: 'guest list, nobody matches',
    run: async (ctx) => {
      tool(ctx, <GuestsScreen />);
      await act(async () => {
        fireEvent.changeText(await screen.findByTestId('guests-query'), 'zzz');
      });
      await screen.findByText(ctx.t('tools.guests.none'));
    },
  },
  {
    name: 'guest list, cannot be loaded',
    run: async (ctx) => {
      const staff = fakeStaff({
        guests: jest
          .fn()
          .mockRejectedValue(new YayatohApiError(new Response(null, { status: 500 }), null)) as never,
      });
      tool(ctx, <GuestsScreen />, makeDeps({ staff }));
      await screen.findByTestId('retry');
    },
    announces: (ctx) => [ctx.t('tools.guests.loadFailed')],
  },
  {
    name: 'guest list, offline with nothing saved',
    run: async (ctx) => {
      tool(ctx, <GuestsScreen />, makeDeps({ useOffline: () => true }));
      await screen.findByText(ctx.t('tools.guests.unavailable'));
    },
    noControls: 'Says the list is not on the phone; nothing to press until it is',
  },
  {
    name: 'help requests',
    run: async (ctx) => {
      tool(ctx, <AssistanceScreen />);
      await screen.findByText(/7/);
    },
    dataLabels: 'Buttons name the request',
  },
  {
    name: 'help requests, none open',
    run: async (ctx) => {
      tool(ctx, <AssistanceScreen />, makeDeps({ staff: fakeStaff({ assistance: async () => [] }) }));
      await screen.findByText(ctx.t('tools.assistance.empty'));
    },
  },
  {
    name: 'help requests, cannot be loaded',
    run: async (ctx) => {
      const staff = fakeStaff({ assistance: jest.fn().mockRejectedValue(new TypeError('x')) as never });
      tool(ctx, <AssistanceScreen />, makeDeps({ staff }));
      await screen.findByTestId('retry');
    },
    announces: (ctx) => [ctx.t('tools.assistance.loadFailed')],
  },
  {
    name: 'today',
    run: async (ctx) => {
      tool(ctx, <TodayScreen />);
      await screen.findByText('Harbor Summit');
    },
  },
  {
    name: 'today, loading',
    run: async (ctx) => {
      const staff = fakeStaff({ overview: never as never });
      tool(ctx, <TodayScreen />, makeDeps({ staff }));
      await screen.findByTestId('loading');
    },
    noHeader: 'The title is not known yet',
    noControls: 'Loading',
  },
  {
    name: 'today, cannot be loaded',
    run: async (ctx) => {
      const staff = fakeStaff({ overview: jest.fn().mockRejectedValue(new TypeError('x')) as never });
      tool(ctx, <TodayScreen />, makeDeps({ staff }));
      await screen.findByTestId('retry');
    },
    announces: (ctx) => [ctx.t('tools.today.loadFailed')],
  },
  {
    name: 'today, a multi-day event with no alerts',
    run: async (ctx) => {
      const staff = fakeStaff({
        overview: async () =>
          overview({
            alerts: [],
            byDate: [
              { day: '2026-10-20', checkedIn: 412 },
              { day: '2026-10-21', checkedIn: 30 },
            ],
          }),
      });
      tool(ctx, <TodayScreen />, makeDeps({ staff }));
      await screen.findByText(ctx.t('tools.today.noAlerts'));
    },
  },
  {
    name: 'leads, not signed in as an exhibitor',
    run: async (ctx) => {
      tool(ctx, <LeadsScreen />);
      await screen.findByText(ctx.t('leads.notSignedIn'));
    },
    noControls: 'Says where to sign in; the way back is the navigation header',
  },
  {
    name: 'leads, list',
    run: async (ctx) => {
      tool(ctx, <LeadsScreen />, makeDeps({ portal: rep() }));
      await screen.findByText('Dana Whitfield');
    },
    dataLabels: 'Buttons name the lead',
  },
  {
    name: 'leads, none yet',
    run: async (ctx) => {
      const api = fakePortal({ leads: async () => ({ leads: [], scope: 'own' }) });
      tool(ctx, <LeadsScreen />, makeDeps({ portal: rep(api) }));
      await screen.findByText(ctx.t('leads.empty'));
    },
  },
  {
    name: 'leads, capture closed',
    run: async (ctx) => {
      const deps = makeDeps({
        portal: rep(),
        clock: { now: () => new Date('2026-10-23T00:00:00Z'), offsetMs: () => 0 },
      });
      tool(ctx, <LeadsScreen />, deps);
      await screen.findByText(ctx.t('leads.gate.closed'));
    },
    dataLabels: 'Buttons name the lead',
  },
  {
    name: 'leads, cannot be loaded',
    run: async (ctx) => {
      const api = fakePortal({ setup: jest.fn().mockRejectedValue(new TypeError('x')) as never });
      tool(ctx, <LeadsScreen />, makeDeps({ portal: rep(api) }));
      await screen.findByText(ctx.t('leads.loadFailed'));
    },
    announces: (ctx) => [ctx.t('leads.loadFailed')],
  },
  {
    name: 'leads, offline',
    run: async (ctx) => {
      const offline = offlineSwitch(true);
      tool(ctx, <LeadsScreen />, makeDeps({ portal: rep(), useOffline: offline.useOffline }));
      await screen.findByText('Dana Whitfield');
    },
    dataLabels: 'Buttons name the lead',
  },
  {
    name: 'lead scan, ready',
    run: async (ctx) => {
      tool(ctx, <LeadScanScreen />, makeDeps({ portal: rep(), Scanner: Camera }));
      await screen.findByTestId('camera');
    },
  },
  {
    name: 'lead scan, a badge read',
    run: async (ctx) => {
      tool(ctx, <LeadScanScreen />, makeDeps({ portal: rep(), Scanner: Camera }));
      await act(async () => {
        fireEvent.press(await screen.findByTestId('camera'));
      });
      await screen.findByTestId('lead-capture');
    },
  },
  {
    name: 'lead scan, no camera',
    run: async (ctx) => {
      tool(ctx, <LeadScanScreen />, makeDeps({ portal: rep() }));
      await settle();
      await waitFor(() => expect(screen.getAllByRole('header').length).toBeGreaterThan(0));
    },
  },
  {
    name: 'lead, detail',
    run: async (ctx) => {
      tool(
        ctx,
        <LeadDetailScreen leadId="77777777-7777-4777-8777-777777777777" />,
        makeDeps({ portal: rep() }),
      );
      await screen.findByText(ctx.t('leads.lead.consent'));
    },
  },
  {
    name: 'event day, not signed in as an organizer',
    run: async (ctx) => {
      tool(ctx, <OpsScreen />);
      await screen.findByText(ctx.t('ops.notSignedIn'));
    },
    noControls: 'Says where to sign in; the way back is the navigation header',
  },
  {
    name: 'event day',
    run: async (ctx) => {
      tool(ctx, <OpsScreen />, makeDeps({ organizer: organizer() }));
      await screen.findByTestId('ops-checkins');
    },
  },
  {
    name: 'event day, offline',
    run: async (ctx) => {
      tool(ctx, <OpsScreen />, makeDeps({ organizer: organizer(), useOffline: () => true }));
      await screen.findByTestId('ops-checkins');
    },
  },
  {
    name: 'event day, cannot be loaded',
    run: async (ctx) => {
      const api = fakeOps({ ops: jest.fn().mockRejectedValue(new TypeError('x')) as never });
      tool(ctx, <OpsScreen />, makeDeps({ organizer: organizer(api) }));
      await screen.findByText(ctx.t('ops.loadFailed'));
    },
    announces: (ctx) => [ctx.t('ops.loadFailed')],
  },
];

// --- the audit -----------------------------------------------------------------------------------

const GROUPS: Record<string, Scenario[]> = {
  'enrolment, sign-in and picker': screens,
  'scan screen': scan,
  'door tools': tools,
};

/** The door tools' titles are the navigation header's (`app/tools/_layout.tsx`), not part of the screen. */
const TITLE_IN_NAVIGATION_HEADER = 'door tools';

const flatten = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown> | undefined;

function audit(scenario: Scenario, locale: Locale, ctx: Ctx, titleInHeader = false) {
  const { problems, controls, headers, names } = auditTree(screen.UNSAFE_root, { flatten }, scenario.audit);
  expect(problems).toEqual([]);
  if (!scenario.noControls) expect(controls).toBeGreaterThan(0);
  if (!scenario.noHeader && !titleInHeader) expect(headers).toBeGreaterThan(0);
  expect(names.filter(hasPlaceholderLeak)).toEqual([]);

  const spoken = announcements(screen.UNSAFE_root).join('\n');
  for (const text of scenario.announces?.(ctx) ?? []) expect(spoken).toContain(text);

  if (locale === 'ar') {
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    // The labels are the Arabic ones, not English left in place.
    if (controls > 0 && !scenario.dataLabels) expect(names.some(hasArabicLetters)).toBe(true);
  } else if (screen.queryByTestId('locale-root')) {
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'ltr' });
  }
}

describe.each(LOCALES)('every Staff screen in %s at the largest text size', (locale) => {
  const ctx: Ctx = { locale, t: (path) => lookup(locale, path) };

  for (const [group, scenarios] of Object.entries(GROUPS)) {
    describe(group, () => {
      it.each(scenarios.map((s) => [s.name, s] as const))('%s', async (_name, scenario) => {
        await scenario.run(ctx);
        await settle();
        audit(scenario, locale, ctx, group === TITLE_IN_NAVIGATION_HEADER);
      });
    });
  }
});

describe.each(LOCALES)('the door tools on an iPad in %s at the largest text size', (locale) => {
  const ctx: Ctx = { locale, t: (path) => lookup(locale, path) };
  it.each(tools.map((s) => [s.name, s] as const))('%s', async (_name, scenario) => {
    mockWidth = 1024;
    await scenario.run(ctx);
    await settle();
    audit(scenario, locale, ctx, true);
  });
});

describe('the audit covers the whole app', () => {
  it('has a scenario for every group of screens', () => {
    const count = Object.values(GROUPS).reduce((n, list) => n + list.length, 0);
    expect(count).toBeGreaterThan(60);
  });

  it('keeps the camera preview named for screen readers', async () => {
    const { engine } = await scanRig();
    await scanView({ locale: 'en', t: (p) => lookup('en', p) }, engine);
    expect(screen.getByLabelText(lookup('en', 'scan.camera.preview'))).toBeOnTheScreen();
  });
});

// The fixtures other scenarios may need; kept imported so a removed scenario does not break the build.
void [json, snapshot, request, lead, opsView, setup, QrCamera];
