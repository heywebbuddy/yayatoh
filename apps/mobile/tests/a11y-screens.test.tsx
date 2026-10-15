/**
 * The rendered accessibility audit of the attendee app (M7.X): every screen, in its main states, in
 * English and in Arabic (right to left), at the largest system font size (fontScale 2).
 *
 * The rules live in `packages/mobile-core/tests/support/a11y-audit.ts`: every control has a role and
 * a spoken name, a 44 point target (hit slop counted), toggles say whether they are on, images are
 * described, nothing hides a control from screen readers, text can grow (no caps, no fixed heights)
 * and the screen scrolls. This file owns the rendering: one scenario per screen state.
 *
 * Jest has no layout engine, so "fits at the largest size" is proven through its causes (see
 * `a11y-static.test.ts`); how it looks on a phone is a device pass (docs/specs/M7.X/a11y.md).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { OfflineBanner, SoftUpdateBanner, UpdateScreen } from '@yayatoh/mobile-core';
import * as Network from 'expo-network';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { Dimensions, Modal, PixelRatio, StyleSheet } from 'react-native';
import {
  type AuditOptions,
  announcements,
  auditTree,
  hasArabicLetters,
  hasPlaceholderLeak,
  nameOf,
} from '@yayatoh/mobile-core/testing/a11y-audit';
import CodeScreen from '../src/app/(auth)/code';
import EmailScreen from '../src/app/(auth)/email';
import LinkProofScreen from '../src/app/(auth)/link-proof';
import PasswordScreen from '../src/app/(auth)/password';
import TwoFactorScreen from '../src/app/(auth)/two-factor';
import Welcome from '../src/app/(auth)/welcome';
import AccountTab from '../src/app/(tabs)/account';
import DeleteAccount from '../src/app/account/delete';
import AccountDeleted from '../src/app/account/deleted';
import LanguageScreen from '../src/app/account/language';
import NotificationSettings from '../src/app/account/notifications';
import { type PendingChallenge, SignInFlowProvider, useSignInFlow } from '../src/auth/flow';
import { CheckoutScreen } from '../src/checkout/checkout-screen';
import { DiscoverScreen } from '../src/discover/discover-screen';
import { EventScreen } from '../src/events/event-screen';
import { ShortLinkScreen } from '../src/events/short-link-screen';
import { OrderLinkScreen } from '../src/orders/order-link-screen';
import { OrderScreen } from '../src/orders/order-screen';
import { OrdersScreen } from '../src/orders/orders-screen';
import { ForegroundBanner, PrePrompt } from '../src/push/components';
import { clearAllCarts, updateCart } from '../src/shop/cart-store';
import { ClaimScreen } from '../src/tickets/screens/claim';
import { RefundScreen } from '../src/tickets/screens/refund';
import { TicketDetailScreen } from '../src/tickets/screens/ticket-detail';
import { TicketLinkScreen } from '../src/tickets/screens/ticket-link';
import { TicketsListScreen } from '../src/tickets/screens/tickets-list';
import { TransferScreen } from '../src/tickets/screens/transfer';
import { createFakeServer } from './helpers/fake-server';
import { createFakeShop, type FakeShop, json, problem } from './helpers/fake-shop';
import { EVENT, ORDER_ID, order, orderSummary, PASSES, SLUG } from './helpers/fixtures';
import { createFakePorts, renderApp as renderShopApp, t as translate } from './helpers/harness';
import { setOnline, setup, teardown } from './helpers/tickets-app';
import {
  claimDetails,
  IDS,
  PAST,
  page,
  summary,
  ticket,
  event as ticketEvent,
  order as ticketOrder,
} from './helpers/tickets-fixtures';
import { resetRouter } from './helpers/tickets-router-mock';
import { problem as ticketProblem } from './helpers/tickets-server';

jest.mock('expo-router', () => ({
  ...require('./helpers/tickets-router-mock').routerMock,
  Tabs: Object.assign(() => null, { Screen: () => null }),
  useSegments: () => [],
}));
jest.mock('../src/auth/apple-button', () => require('./helpers/apple-button-mock'));
jest.mock('../src/auth/methods', () => ({ availableMethods: () => ({ apple: true, google: true }) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 2 }),
}));
jest.mock('../src/push/provider', () => ({
  ...jest.requireActual('../src/push/provider'),
  usePush: () => mockPush.current,
}));

const mockPush: { current: unknown } = { current: null };

const FONT_SCALE = 2;
const LOCALES = ['en', 'ar'] as const;
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
  /** The controls are named after the person's own data (names, events), so they need not be Arabic. */
  readonly dataLabels?: string;
  readonly audit?: AuditOptions;
  /** Why this state has nothing to press (a loading or a plain notice). */
  readonly noControls?: string;
}

const apps: ReturnType<typeof setup>[] = [];
const settle = () => act(async () => {});
const tap = async (testID: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
};
const typeInto = (testID: string, text: string) => fireEvent.changeText(screen.getByTestId(testID), text);

beforeAll(() => {
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(FONT_SCALE);
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: FONT_SCALE },
    screen: { width: 390, height: 844, scale: 3, fontScale: FONT_SCALE },
  });
});
beforeEach(() => {
  resetRouter();
  clearAllCarts();
  setOnline(true);
  mockPush.current = null;
  (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  });
});
afterEach(() => {
  setOnline(true);
  teardown(apps);
});

// --- rendering helpers ------------------------------------------------------------------------

const asShop = (server: unknown) => server as FakeShop;

/** The sign-in screens need the flow the `(auth)` layout provides; `Seed` fills it before the screen shows. */
function Seed({
  email,
  pending,
  children,
}: {
  email?: string;
  pending?: PendingChallenge;
  children: ReactNode;
}) {
  const flow = useSignInFlow();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (email) flow.setEmail(email);
    if (pending) flow.setPending(pending);
    setReady(true);
  }, []);
  return ready ? children : null;
}

async function authScreen(
  ctx: Ctx,
  ui: ReactElement,
  seed: {
    email?: string;
    pending?: PendingChallenge;
    signedIn?: boolean;
    server?: ReturnType<typeof createFakeServer>;
  } = {},
) {
  const server = seed.server ?? createFakeServer();
  await renderShopApp(
    <SignInFlowProvider>
      <Seed
        {...(seed.email ? { email: seed.email } : {})}
        {...(seed.pending ? { pending: seed.pending } : {})}
      >
        {ui}
      </Seed>
    </SignInFlowProvider>,
    { locale: ctx.locale, signedIn: seed.signedIn ?? false, shop: asShop(server) },
  );
  await settle();
}

async function shopScreen(
  ctx: Ctx,
  ui: ReactElement,
  options: { shop?: FakeShop; signedIn?: boolean; user?: { emailVerified: boolean } } = {},
) {
  await renderShopApp(ui, { locale: ctx.locale, ...options });
}

/** The attendee's tickets screens run over their own fake server and services. */
function ticketsApp(ctx: Ctx, options: { signedIn?: boolean } = {}) {
  const app = setup({ locale: ctx.locale, ...options });
  apps.push(app);
  app.server.on('GET /v1/me/tickets/:id', (_c, p) => ticket({ id: p.id as string }));
  app.server.on('GET /v1/me/tickets', () => page([summary({ id: IDS.t1 })]));
  return app;
}

const never = () => new Promise<Response>(() => {});

// --- the scenarios ----------------------------------------------------------------------------

const auth: Scenario[] = [
  {
    name: 'welcome',
    run: async (ctx) => {
      await authScreen(ctx, <Welcome />);
      await screen.findByTestId('welcome-email');
    },
  },
  {
    name: 'welcome, offline on first launch',
    run: async (ctx) => {
      (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
      });
      await authScreen(ctx, <Welcome />);
      await screen.findByTestId('welcome-offline');
    },
    announces: () => [],
  },
  {
    name: 'welcome, a sign-in that fails',
    run: async (ctx) => {
      await authScreen(ctx, <Welcome />);
      await tap('welcome-google');
      await screen.findByTestId('welcome-error');
    },
    announces: (ctx) =>
      [screen.getByTestId('welcome-error').props.children as string, ctx.locale].slice(0, 1),
  },
  {
    name: 'email',
    run: async (ctx) => {
      await authScreen(ctx, <EmailScreen />);
      await screen.findByTestId('email-input');
    },
  },
  {
    name: 'email, an address that is not one',
    run: async (ctx) => {
      await authScreen(ctx, <EmailScreen />);
      typeInto('email-input', 'ada');
      await tap('email-submit');
      await screen.findByTestId('email-input-error');
    },
    announces: (ctx) => [ctx.t('signIn.email.invalid')],
  },
  {
    name: 'code',
    run: async (ctx) => {
      await authScreen(ctx, <CodeScreen />, { email: 'ada@example.test' });
      await screen.findByTestId('code-input');
    },
  },
  {
    name: 'code, too few digits',
    run: async (ctx) => {
      await authScreen(ctx, <CodeScreen />, { email: 'ada@example.test' });
      await tap('code-submit');
      await screen.findByTestId('code-input-error');
    },
    announces: (ctx) => [ctx.t('signIn.code.incomplete')],
  },
  {
    name: 'password',
    run: async (ctx) => {
      await authScreen(ctx, <PasswordScreen />);
      await screen.findByTestId('password-input');
    },
  },
  {
    name: 'password, nothing typed',
    run: async (ctx) => {
      await authScreen(ctx, <PasswordScreen />);
      await tap('password-submit');
      await screen.findByTestId('password-input-error');
    },
    announces: (ctx) => [ctx.t('signIn.password.required'), ctx.t('signIn.email.required')],
  },
  {
    name: 'two-step code',
    run: async (ctx) => {
      await authScreen(ctx, <TwoFactorScreen />, {
        pending: { step: 'twoFactor', challenge: 'c1', expiresAt: null },
      });
      await screen.findByTestId('two-factor-input');
    },
  },
  {
    name: 'two-step code, nothing typed',
    run: async (ctx) => {
      await authScreen(ctx, <TwoFactorScreen />, {
        pending: { step: 'twoFactor', challenge: 'c1', expiresAt: null },
      });
      await tap('two-factor-submit');
      await screen.findByTestId('two-factor-input-error');
    },
    announces: (ctx) => [ctx.t('signIn.twoFactor.required')],
  },
  {
    name: 'link proof',
    run: async (ctx) => {
      await authScreen(ctx, <LinkProofScreen />, {
        pending: { step: 'emailProof', challenge: 'c1', expiresAt: null },
      });
      await screen.findByTestId('link-proof-input');
    },
  },
  {
    name: 'link proof, too few digits',
    run: async (ctx) => {
      await authScreen(ctx, <LinkProofScreen />, {
        pending: { step: 'emailProof', challenge: 'c1', expiresAt: null },
      });
      await tap('link-proof-submit');
      await screen.findByTestId('link-proof-input-error');
    },
    announces: (ctx) => [ctx.t('signIn.code.incomplete')],
  },
];

const account: Scenario[] = [
  {
    name: 'account',
    run: async (ctx) => {
      await authScreen(ctx, <AccountTab />, { signedIn: true });
      await screen.findByTestId('account-screen');
    },
  },
  {
    name: 'account, asking to sign out',
    run: async (ctx) => {
      await authScreen(ctx, <AccountTab />, { signedIn: true });
      await tap('account-sign-out');
      await screen.findByTestId('account-confirm-sign-out');
    },
  },
  {
    name: 'account, sign out everywhere that cannot be reached',
    run: async (ctx) => {
      const server = createFakeServer();
      server.config.offline = true;
      await authScreen(ctx, <AccountTab />, { signedIn: true, server });
      await tap('account-sign-out-everywhere');
      await tap('account-everywhere-confirm');
      await screen.findByTestId('account-everywhere-problem');
    },
    announces: (ctx) => [ctx.t('account.signOutEverywhere.failed')],
  },
  {
    name: 'language',
    run: async (ctx) => {
      await authScreen(ctx, <LanguageScreen />, { signedIn: true });
      await screen.findByTestId('language-screen');
    },
  },
  {
    name: 'delete account, what happens',
    run: async (ctx) => {
      await authScreen(ctx, <DeleteAccount />, { signedIn: true });
      await screen.findByTestId('delete-continue');
    },
  },
  {
    name: 'delete account, asking for proof',
    run: async (ctx) => {
      await authScreen(ctx, <DeleteAccount />, { signedIn: true });
      await tap('delete-continue');
      await screen.findByTestId('delete-proof');
    },
  },
  {
    name: 'delete account, missing proof',
    run: async (ctx) => {
      await authScreen(ctx, <DeleteAccount />, { signedIn: true });
      await tap('delete-continue');
      await screen.findByTestId('delete-proof');
      await tap('delete-submit');
      await screen.findByTestId('delete-proof-error');
    },
    announces: (ctx) => [ctx.t('account.delete.proofRequired'), ctx.t('account.delete.emailRequired')],
  },
  {
    name: 'account deleted',
    run: async (ctx) => {
      await authScreen(ctx, <AccountDeleted />);
      await screen.findByTestId('account-deleted-screen');
    },
  },
];

const prefs = (supported: boolean, fail = false) => ({
  supported,
  load: async () => ({ reminders: true, eventChanges: false }),
  save: async () => {
    if (fail) throw new Error('offline');
  },
});
const pushState = (
  permission: 'granted' | 'denied' | 'undetermined' | null,
  supported = true,
  fail = false,
) => ({
  permission,
  preferences: prefs(supported, fail),
  askFromSettings: jest.fn(),
  openSystemSettings: jest.fn(async () => {}),
});

const notifications: Scenario[] = (
  [
    ['granted', true],
    ['denied', true],
    ['undetermined', true],
    ['loading', false],
  ] as const
).map(([permission, supported]) => ({
  name: `notification settings, ${permission}${supported ? '' : ' (kinds unavailable)'}`,
  ...(permission === 'loading' ? { noControls: 'The phone has not answered yet' } : {}),
  run: async (ctx: Ctx) => {
    mockPush.current = pushState(permission === 'loading' ? null : permission, supported);
    await shopScreen(ctx, <NotificationSettings />);
    await screen.findByTestId('notification-settings');
    await settle();
  },
}));
notifications.push({
  name: 'notification settings, a preference that could not be saved',
  run: async (ctx) => {
    mockPush.current = pushState('granted', true, true);
    await shopScreen(ctx, <NotificationSettings />);
    await screen.findByTestId('switch-reminders');
    await settle();
    await act(async () => {
      fireEvent(screen.getByTestId('switch-reminders'), 'valueChange', false);
    });
    await screen.findByTestId('save-failed');
  },
  announces: (ctx) => [ctx.t('push.settings.saveFailed')],
});

const push: Scenario[] = [
  ...([true, false] as const).map((remembers) => ({
    name: `push explanation (${remembers ? 'asked again later' : 'asked once'})`,
    run: async (ctx: Ctx) => {
      await shopScreen(
        ctx,
        <PrePrompt visible remembers={remembers} onAllow={() => {}} onNotNow={() => {}} />,
      );
      await screen.findByTestId('push-preprompt');
    },
    audit: { fixedLayout: 'A sheet with its own scroll view; the audit also sees it' },
  })),
  ...([true, false] as const).map((openable) => ({
    name: `push banner (${openable ? 'opens a screen' : 'text only'})`,
    run: async (ctx: Ctx) => {
      await shopScreen(
        ctx,
        <ForegroundBanner
          title="Doors open at 7"
          body="Summer Night starts in one hour. Bring your ticket."
          openable={openable}
          onOpen={() => {}}
          onDismiss={() => {}}
          visibleMs={60_000}
        />,
      );
      await screen.findByTestId('push-banner');
    },
    announces: () => ['Doors open at 7'],
    noHeader: 'A notification has no heading',
    audit: { fixedLayout: 'A banner over the screen, never a screen of its own' },
  })),
];

const shell: Scenario[] = [
  {
    name: 'update required, with the store link',
    run: async (ctx) => {
      await shopScreen(
        ctx,
        <UpdateScreen appName="Yayatoh" minimumVersion="2.0.0" storeUrl="https://stores.test/app" />,
      );
      await screen.findByTestId('update-screen');
    },
  },
  {
    name: 'update required, without a store link',
    run: async (ctx) => {
      await shopScreen(ctx, <UpdateScreen appName="Yayatoh" minimumVersion={null} storeUrl={null} />);
      await screen.findByTestId('update-no-link');
    },
    noControls: 'Tells the person to open the store themselves; there is no link to press',
  },
  {
    name: 'update available',
    run: async (ctx) => {
      await shopScreen(
        ctx,
        <SoftUpdateBanner
          appName="Yayatoh"
          latestVersion="2.1.0"
          storeUrl="https://stores.test/app"
          onDismiss={() => {}}
        />,
      );
      await screen.findByTestId('soft-update');
    },
    announces: (ctx) => [ctx.t('core.update.softTitle')],
    noHeader: 'A banner above the app',
    audit: { fixedLayout: 'A banner above the app, never a screen of its own' },
  },
  {
    name: 'offline banner',
    run: async (ctx) => {
      await shopScreen(ctx, <OfflineBanner offline queued={2} />);
      await screen.findByTestId('offline-banner');
    },
    announces: (ctx) => [ctx.t('core.offline.banner')],
    noHeader: 'A banner above the app',
    audit: { fixedLayout: 'A banner above the app, never a screen of its own' },
    noControls: 'A message above the app; nothing to press',
  },
];

const searchAnswer = (data: unknown[]) => () => json(200, { data, nextCursor: null });
const shopFor = (routes: (shop: FakeShop) => void) => {
  const shop = createFakeShop();
  routes(shop);
  return shop;
};

const discover: Scenario[] = [
  {
    name: 'discover, results',
    run: async (ctx) => {
      await shopScreen(ctx, <DiscoverScreen />);
      await screen.findByTestId('event-event-1');
    },
  },
  {
    name: 'discover, loading',
    run: async (ctx) => {
      await shopScreen(ctx, <DiscoverScreen />, {
        shop: shopFor((s) => s.on('GET', '/v1/public/events', never)),
      });
      await screen.findByTestId('loading');
    },
  },
  {
    name: 'discover, nothing on yet',
    run: async (ctx) => {
      await shopScreen(ctx, <DiscoverScreen />, {
        shop: shopFor((s) => s.on('GET', '/v1/public/events', searchAnswer([]))),
      });
      await screen.findByTestId('discover-empty');
    },
  },
  {
    name: 'discover, nothing matches the filters',
    run: async (ctx) => {
      await shopScreen(ctx, <DiscoverScreen />, {
        shop: shopFor((s) => s.on('GET', '/v1/public/events', searchAnswer([]))),
      });
      await screen.findByTestId('discover-empty');
      await tap('category-music');
      await waitFor(() => expect(screen.getByTestId('clear-filters')).toBeOnTheScreen());
    },
  },
  {
    name: 'discover, the search fails',
    run: async (ctx) => {
      await shopScreen(ctx, <DiscoverScreen />, {
        shop: shopFor((s) =>
          s.on('GET', '/v1/public/events', () => {
            throw new TypeError('Network request failed');
          }),
        ),
      });
      await screen.findByTestId('search-error');
    },
    announces: (ctx) => [ctx.t('discover.errorTitle')],
  },
  {
    name: 'discover, a date typed wrong',
    run: async (ctx) => {
      await shopScreen(ctx, <DiscoverScreen />);
      await screen.findByTestId('event-event-1');
      await tap('when-custom');
      typeInto('date-from', '2027-5');
      await waitFor(() => expect(screen.getByTestId('date-from')).toBeOnTheScreen());
    },
    announces: (ctx) => [ctx.t('discover.dateError.from_format')],
  },
  {
    name: 'discover, near me refused',
    run: async (ctx) => {
      const ports = createFakePorts();
      ports.location.requestNearMe.mockResolvedValue({ status: 'denied', canAskAgain: false });
      await renderShopApp(<DiscoverScreen />, { locale: ctx.locale, ports });
      await screen.findByTestId('event-event-1');
      await tap('near-me');
      await screen.findByTestId('near-me-denied');
    },
    announces: (ctx) => [ctx.t('discover.nearMeDeniedTitle')],
  },
];

const event: Scenario[] = [
  {
    name: 'event',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={null} />);
      await screen.findByTestId('pass-pass-general');
    },
  },
  {
    name: 'event, a pass chosen',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={null} />);
      await screen.findByTestId('pass-pass-general');
      const plus = screen.getAllByRole('button').find((b) => /increase|زيادة|\+/i.test(nameOf(b)));
      if (plus) await act(async () => void fireEvent.press(plus));
    },
  },
  {
    name: 'event, loading',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={null} />, {
        shop: shopFor((s) => s.on('GET', `/v1/public/events/${SLUG}`, never)),
      });
      await screen.findByLabelText(ctx.t('discover.event.loading'));
    },
    noHeader: 'The title is not known yet',
    noControls: 'Loading',
  },
  {
    name: 'event, not found',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={null} />, {
        shop: shopFor((s) => s.on('GET', `/v1/public/events/${SLUG}`, () => problem(404, 'not_found'))),
      });
      await screen.findByTestId('event-not-found');
    },
  },
  {
    name: 'event, cannot be loaded',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={null} />, {
        shop: shopFor((s) =>
          s.on('GET', `/v1/public/events/${SLUG}`, () => {
            throw new TypeError('Network request failed');
          }),
        ),
      });
      await screen.findByTestId('event-error');
    },
    announces: (ctx) => [ctx.t('core.errors.network')],
    noHeader: 'The title is not known',
  },
  {
    name: 'event, the tickets cannot be loaded',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={null} />, {
        shop: shopFor((s) =>
          s.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () => problem(500, 'internal')),
        ),
      });
      await screen.findByTestId('tickets-error');
    },
  },
  {
    name: 'event, no tickets on sale',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={null} />, {
        shop: shopFor((s) => s.on('GET', `/v1/public/events/${SLUG}/ticket-types`, searchAnswer([]))),
      });
      await screen.findByTestId('no-passes');
    },
  },
  {
    name: 'event, cancelled',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={null} />, {
        shop: shopFor((s) =>
          s.on('GET', `/v1/public/events/${SLUG}`, () => json(200, { ...EVENT, status: 'cancelled' })),
        ),
      });
      await waitFor(() => expect(screen.queryByTestId('pass-pass-general')).toBeNull());
      await screen.findByText(new RegExp(ctx.t('discover.event.statusCancelled').slice(0, 6)));
    },
  },
  {
    name: 'event, online (tickets are bought on the web)',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={null} />, {
        shop: shopFor((s) =>
          s.on('GET', `/v1/public/events/${SLUG}`, () =>
            json(200, { ...EVENT, attendanceMode: 'online', venueSlug: null, venueName: null }),
          ),
        ),
      });
      await screen.findByTestId('event-where');
      await settle();
    },
  },
  {
    name: 'event, back from a cancelled payment',
    run: async (ctx) => {
      await shopScreen(ctx, <EventScreen slug={SLUG} marker={{ outcome: 'cancelled', orderId: null }} />);
      await screen.findByTestId('pass-pass-general');
      await settle();
    },
  },
];

const checkout: Scenario[] = [
  {
    name: 'checkout, review',
    run: async (ctx) => {
      updateCart(SLUG, { cart: { 'pass-general': 2 } });
      await shopScreen(ctx, <CheckoutScreen slug={SLUG} />);
      await waitFor(() => expect(screen.getByTestId('checkout-total')).toBeOnTheScreen());
    },
  },
  {
    name: 'checkout, loading',
    run: async (ctx) => {
      updateCart(SLUG, { cart: { 'pass-general': 2 } });
      await shopScreen(ctx, <CheckoutScreen slug={SLUG} />, {
        shop: shopFor((s) => s.on('GET', `/v1/public/events/${SLUG}`, never)),
      });
      await screen.findByLabelText(ctx.t('checkout.loading'));
    },
    noHeader: 'The title is not known yet',
    noControls: 'Loading',
  },
  {
    name: 'checkout, cannot be loaded',
    run: async (ctx) => {
      updateCart(SLUG, { cart: { 'pass-general': 2 } });
      await shopScreen(ctx, <CheckoutScreen slug={SLUG} />, {
        shop: shopFor((s) =>
          s.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () => problem(500, 'internal')),
        ),
      });
      await screen.findByTestId('checkout-load-error');
    },
  },
  {
    name: 'checkout, signed out',
    run: async (ctx) => {
      updateCart(SLUG, { cart: { 'pass-general': 2 } });
      await shopScreen(ctx, <CheckoutScreen slug={SLUG} />, { signedIn: false });
      await screen.findByTestId('checkout-sign-in');
    },
  },
  {
    name: 'checkout, address not verified',
    run: async (ctx) => {
      updateCart(SLUG, { cart: { 'pass-general': 2 } });
      await shopScreen(ctx, <CheckoutScreen slug={SLUG} />, { user: { emailVerified: false } });
      await screen.findByTestId('checkout-unverified');
    },
  },
  {
    name: 'checkout, the payment fails',
    run: async (ctx) => {
      updateCart(SLUG, { cart: { 'pass-general': 2 } });
      const shop = shopFor((s) => {
        s.nextCheckout = () => problem(500, 'internal');
      });
      await shopScreen(ctx, <CheckoutScreen slug={SLUG} />, { shop });
      await waitFor(() => expect(screen.getByTestId('checkout-pay')).toBeOnTheScreen());
      await waitFor(() =>
        expect(screen.getByTestId('checkout-pay').props.accessibilityState.disabled).toBe(false),
      );
      await tap('checkout-pay');
      await screen.findByTestId('checkout-error');
    },
    announces: (ctx) => [ctx.t('checkout.errors.unknown')],
  },
];

const orders: Scenario[] = [
  {
    name: 'orders, list',
    run: async (ctx) => {
      await shopScreen(ctx, <OrdersScreen />, {
        shop: shopFor((s) =>
          s.on(
            'GET',
            '/v1/me/orders',
            searchAnswer([orderSummary(1), orderSummary(2, { status: 'refunded' })]),
          ),
        ),
      });
      await screen.findByTestId(`order-${orderSummary(1).id}`);
    },
  },
  {
    name: 'orders, none yet',
    run: async (ctx) => {
      await shopScreen(ctx, <OrdersScreen />, {
        shop: shopFor((s) => s.on('GET', '/v1/me/orders', searchAnswer([]))),
      });
      await screen.findByTestId('orders-empty');
    },
  },
  {
    name: 'orders, loading',
    run: async (ctx) => {
      await shopScreen(ctx, <OrdersScreen />, { shop: shopFor((s) => s.on('GET', '/v1/me/orders', never)) });
      await screen.findByLabelText(ctx.t('orders.loading'));
    },
  },
  {
    name: 'orders, no connection',
    run: async (ctx) => {
      await shopScreen(ctx, <OrdersScreen />, {
        shop: shopFor((s) =>
          s.on('GET', '/v1/me/orders', () => {
            throw new TypeError('Network request failed');
          }),
        ),
      });
      await screen.findByTestId('orders-error');
    },
    announces: (ctx) => [ctx.t('core.errors.network')],
  },
  {
    name: 'order',
    run: async (ctx) => {
      const shop = createFakeShop();
      shop.pay(ORDER_ID);
      await shopScreen(ctx, <OrderScreen id={ORDER_ID} placed={null} />, { shop });
      await screen.findByTestId('order-view-event');
    },
  },
  {
    name: 'order, just placed',
    run: async (ctx) => {
      const shop = createFakeShop();
      shop.pay(ORDER_ID);
      await shopScreen(ctx, <OrderScreen id={ORDER_ID} placed="confirmed" />, { shop });
      await screen.findByTestId('order-view-tickets');
    },
    announces: (ctx) => [ctx.t('orders.confirmed.title')],
  },
  {
    name: 'order, payment still being confirmed',
    run: async (ctx) => {
      await shopScreen(ctx, <OrderScreen id={ORDER_ID} placed="pending" />, {
        shop: shopFor((s) => s.on('GET', `/v1/me/orders/${ORDER_ID}`, () => problem(404, 'not_found'))),
      });
      await screen.findByTestId('order-processing');
    },
  },
  {
    name: 'order, loading',
    run: async (ctx) => {
      await shopScreen(ctx, <OrderScreen id={ORDER_ID} placed={null} />, {
        shop: shopFor((s) => s.on('GET', `/v1/me/orders/${ORDER_ID}`, never)),
      });
      await screen.findByLabelText(ctx.t('orders.loading'));
    },
    noHeader: 'The title is not known yet',
    noControls: 'Loading',
  },
  {
    name: 'order, cannot be loaded',
    run: async (ctx) => {
      await shopScreen(ctx, <OrderScreen id={ORDER_ID} placed={null} />, {
        shop: shopFor((s) => s.on('GET', `/v1/me/orders/${ORDER_ID}`, () => problem(500, 'internal'))),
      });
      await screen.findByTestId('order-error');
    },
    announces: (ctx) => [ctx.t('core.errors.generic')],
  },
  {
    name: 'order link from an email',
    run: async (ctx) => {
      await shopScreen(ctx, <OrderLinkScreen token="abc-123" />, { signedIn: false });
      await screen.findByTestId('order-link-open');
    },
  },
  {
    name: 'short link, looking up',
    run: async (ctx) => {
      const ports = createFakePorts();
      ports.links.resolveShortCode.mockReturnValue(new Promise(() => {}));
      await renderShopApp(<ShortLinkScreen code="abc" />, { locale: ctx.locale, ports });
      await settle();
    },
    noHeader: 'A lookup that lasts a moment',
    noControls: 'Loading',
  },
  {
    name: 'short link, no such event',
    run: async (ctx) => {
      const ports = createFakePorts();
      ports.links.resolveShortCode.mockResolvedValue(null);
      await renderShopApp(<ShortLinkScreen code="abc" />, { locale: ctx.locale, ports });
      await screen.findByTestId('short-link-not-found');
    },
  },
  {
    name: 'short link, lookup fails',
    run: async (ctx) => {
      const ports = createFakePorts();
      ports.links.resolveShortCode.mockRejectedValue(new Error('offline'));
      await renderShopApp(<ShortLinkScreen code="abc" />, { locale: ctx.locale, ports });
      await settle();
      await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
    },
    noHeader: 'An error banner with its own title',
  },
];

const tickets: Scenario[] = [
  {
    name: 'my tickets, upcoming',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets', () =>
        page([
          summary({ id: IDS.t1 }),
          summary({
            id: IDS.t2,
            holderName: 'Grace Hopper',
            seatLabel: 'Row 4, Seat 12',
            pendingTransfer: true,
          }),
        ]),
      );
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId(`ticket-card-${IDS.t1}`);
    },
  },
  {
    name: 'my tickets, loading',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets', never);
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId('loading');
    },
  },
  {
    name: 'my tickets, none yet',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets', () => page([]));
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId('empty-upcoming');
    },
  },
  {
    name: 'my tickets, past',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets', () => page([]));
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId('empty-upcoming');
      await tap('segment-past');
      await screen.findByTestId('empty-past');
    },
  },
  {
    name: 'my tickets, cannot be loaded',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets', () => ticketProblem(403, 'forbidden'));
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId('list-error');
    },
  },
  {
    name: 'my tickets, offline with nothing saved',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.offline = true;
      setOnline(false);
      await app.ready;
      app.view(<TicketsListScreen />);
      await screen.findByTestId('offline-note');
    },
  },
  {
    name: 'ticket',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      await screen.findByTestId('qr-card');
    },
  },
  {
    name: 'ticket, cancelled',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets/:id', () => ticket({ status: 'void', qrCode: null }));
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      await settle();
      await waitFor(() => expect(screen.getAllByRole('header').length).toBeGreaterThan(0));
    },
  },
  {
    name: 'ticket, event is over',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets/:id', () => ticket({ event: { ...ticket().event, ...PAST } }));
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      await screen.findByTestId('qr-card');
    },
  },
  {
    name: 'ticket, transfer pending',
    run: async (ctx) => {
      const base = ticket();
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets/:id', () =>
        ticket({
          transfer: {
            ...base.transfer,
            pending: {
              id: IDS.transfer,
              toName: 'Grace Hopper',
              toEmail: 'grace@example.test',
              expiresAt: '2030-02-20T12:00:00Z',
            },
          } as never,
        }),
      );
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      await screen.findByTestId('qr-card');
    },
  },
  {
    name: 'ticket, loading',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets/:id', never);
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      await screen.findByTestId('loading');
    },
    noHeader: 'The title is not known yet',
  },
  {
    name: 'ticket, not found',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets/:id', () => ticketProblem(404, 'not_found'));
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      await settle();
      await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
    },
  },
  {
    name: 'ticket, cannot be loaded',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/tickets/:id', () => ticketProblem(403, 'forbidden'));
      await app.ready;
      app.view(<TicketDetailScreen id={IDS.t1} />);
      await settle();
      await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
    },
    noHeader: 'An error banner with its own title',
  },
  {
    name: 'transfer',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      await app.ready;
      app.view(<TransferScreen id={IDS.t1} />);
      await screen.findByTestId('transfer-form');
    },
  },
  {
    name: 'transfer, form not filled in',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      await app.ready;
      app.view(<TransferScreen id={IDS.t1} />);
      await screen.findByTestId('transfer-form');
      await act(async () => {
        fireEvent.press(screen.getByTestId('review'));
      });
      await waitFor(() => expect(screen.getByTestId('to-name')).toBeOnTheScreen());
    },
    announces: (ctx) => [ctx.t('tickets.transfer.nameRequired')],
  },
  {
    name: 'transfer, confirm',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      await app.ready;
      app.view(<TransferScreen id={IDS.t1} />);
      await screen.findByTestId('transfer-form');
      fireEvent.changeText(screen.getByTestId('to-name'), 'Grace Hopper');
      fireEvent.changeText(screen.getByTestId('to-email'), 'grace@example.test');
      await act(async () => {
        fireEvent.press(screen.getByTestId('review'));
      });
      await screen.findByTestId('send');
    },
  },
  {
    name: 'refund request',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/orders/:id', () => ticketOrder());
      await app.ready;
      app.view(<RefundScreen id={IDS.t1} />);
      await screen.findByTestId('refund-panel');
    },
  },
  {
    name: 'refund request, loading',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/orders/:id', never);
      await app.ready;
      app.view(<RefundScreen id={IDS.t1} />);
      await settle();
      await screen.findByTestId('loading');
    },
    noHeader: 'The title is not known yet',
  },
  {
    name: 'claim',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/claims/:token', () => claimDetails());
      await app.ready;
      app.view(<ClaimScreen token="claimtoken-abcdef123456" />);
      await screen.findByTestId('claim-name');
    },
  },
  {
    name: 'claim, already claimed',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/claims/:token', () => ticketProblem(410, 'gone', { state: 'claimed' }));
      await app.ready;
      app.view(<ClaimScreen token="claimtoken-abcdef123456" />);
      await settle();
      await waitFor(() => expect(screen.getAllByRole('header').length).toBeGreaterThan(0));
    },
  },
  {
    name: 'claim, signed out',
    run: async (ctx) => {
      const app = ticketsApp(ctx, { signedIn: false });
      app.server.on('GET /v1/claims/:token', () => claimDetails());
      await app.ready;
      app.view(<ClaimScreen token="claimtoken-abcdef123456" />);
      await settle();
      await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
    },
  },
  {
    name: 'ticket link, signed out',
    run: async (ctx) => {
      const app = ticketsApp(ctx, { signedIn: false });
      await app.ready;
      app.view(<TicketLinkScreen token="11111111-1111-4111-8111-111111111111~sig" />);
      await screen.findByTestId('link-sign-in');
    },
  },
  {
    name: 'ticket link, several tickets',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/ticket-links/:token', () => ({ ticketIds: [IDS.t1, IDS.t2] }));
      await app.ready;
      app.view(<TicketLinkScreen token="11111111-1111-4111-8111-111111111111~sig" />);
      await settle();
      await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
    },
    dataLabels: 'Each button is a ticket, named after its holder and event',
  },
  {
    name: 'ticket link, none of yours',
    run: async (ctx) => {
      const app = ticketsApp(ctx);
      app.server.on('GET /v1/me/ticket-links/:token', () => ticketProblem(404, 'not_found'));
      await app.ready;
      app.view(<TicketLinkScreen token="11111111-1111-4111-8111-111111111111~sig" />);
      await settle();
      await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
    },
    noHeader: 'An error banner with its own title',
  },
];

// --- the audit --------------------------------------------------------------------------------

const GROUPS: Record<string, Scenario[]> = {
  'sign in': auth,
  account,
  notifications,
  'push and the shell': [...push, ...shell],
  discover,
  event,
  checkout,
  'orders and links': orders,
  tickets,
};

const flatten = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown> | undefined;

describe.each(LOCALES)('every attendee screen in %s at the largest text size', (locale) => {
  const ctx: Ctx = { locale, t: (path) => translate(locale, path) };

  for (const [group, scenarios] of Object.entries(GROUPS)) {
    describe(group, () => {
      it.each(scenarios.map((s) => [s.name, s] as const))('%s', async (_name, scenario) => {
        await scenario.run(ctx);
        await settle();

        const { problems, controls, headers, names } = auditTree(
          screen.UNSAFE_root,
          { flatten },
          scenario.audit,
        );
        expect(problems).toEqual([]);
        if (!scenario.noControls) expect(controls).toBeGreaterThan(0);
        if (!scenario.noHeader) expect(headers).toBeGreaterThan(0);
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
      });
    });
  }
});

describe('a chosen row or tab is marked by more than colour', () => {
  const ticks = (node: Parameters<typeof within>[0]) =>
    within(node).queryAllByText('✓', { includeHiddenElements: true }).length;

  it('puts a tick on the chosen language and the chosen theme, and on no other row', async () => {
    await authScreen({ locale: 'en', t: (p) => translate('en', p) }, <LanguageScreen />, { signedIn: true });
    const chosen = screen.getByTestId('language-system');
    expect(chosen.props.accessibilityState).toMatchObject({ checked: true });
    expect(ticks(chosen)).toBe(1);
    expect(ticks(screen.getByTestId('language-en'))).toBe(0);
  });

  it('puts a tick on the open tab of My tickets', async () => {
    const app = ticketsApp({ locale: 'en', t: (p) => translate('en', p) });
    await app.ready;
    app.view(<TicketsListScreen />);
    await screen.findByTestId(`ticket-card-${IDS.t1}`);
    expect(ticks(screen.getByTestId('segment-upcoming'))).toBe(1);
    expect(ticks(screen.getByTestId('segment-past'))).toBe(0);
  });
});

describe('the push explanation is a real modal', () => {
  it('sets accessibilityViewIsModal inside the Modal so focus stays in the sheet, and Not now closes it', async () => {
    const close = jest.fn();
    await shopScreen(
      { locale: 'en', t: (p) => translate('en', p) },
      <PrePrompt visible remembers={false} onAllow={() => {}} onNotNow={close} />,
    );
    const modal = screen.UNSAFE_getByType(Modal);
    expect(modal.props.onRequestClose).toBe(close);
    expect(screen.UNSAFE_getAllByProps({ accessibilityViewIsModal: true }).length).toBeGreaterThan(0);
  });
});

describe('the audit covers the whole app', () => {
  it('has scenarios for every screen file', () => {
    const count = Object.values(GROUPS).reduce((n, list) => n + list.length, 0);
    expect(count).toBeGreaterThan(90);
  });
});

// Keep the fixtures the scenarios build on from being flagged as unused when a scenario is removed.
void [EVENT, PASSES, order, json, ticketEvent];
