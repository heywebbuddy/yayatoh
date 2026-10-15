/**
 * Push for the attendee app (M7.3d), mounted once inside the root layout:
 *
 * - **Asking** (`legal-copy`, P7-8): only at the first purchase and the first time a ticket is
 *   opened, after a pre-prompt, never at launch. "Not now" is asked again only after a later
 *   purchase. A refusal never blocks anything: nothing in the app waits on this provider.
 * - **Registering**: the phone's token goes to `POST /v1/me/devices` once the person is signed in and
 *   the phone allows notifications, again when anything changes, and is deleted at sign-out.
 * - **Opening**: a tapped push opens its screen from a cold start, a warm start and the foreground.
 * - **Foreground**: a push that arrives while the app is open is an in-app banner.
 */
import { routeForPush, useCore, useLocaleSettings, useSession } from '@yayatoh/mobile-core';
import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { useTranslations } from 'use-intl';
import { takePendingHref } from '../links/pending';
import { ForegroundBanner, PrePrompt } from './components';
import type { IncomingPush, PushPermission, PushPort } from './port';
import type { PreferencesPort } from './preferences';
import { serverPreferencesUnavailable } from './preferences';
import {
  afterNotNow,
  afterPurchase,
  decidePrompt,
  loadPromptState,
  type PushMoment,
  savePromptState,
} from './prompt-state';
import { createPushRegistrar, type DeviceFacts } from './registration';
import { createTapLedger, hrefForPush } from './routing';
import { onPushMoment, reportPushMoment } from './signals';

export interface PushApi {
  /** The phone's answer, or null while it is being read. */
  readonly permission: PushPermission | null;
  readonly preferences: PreferencesPort;
  /** Shows the explanation and then the phone's sheet (the Notifications screen's own button). */
  askFromSettings(): void;
  openSystemSettings(): Promise<void>;
}

const PushContext = createContext<PushApi | null>(null);

export function usePush(): PushApi {
  const api = useContext(PushContext);
  if (!api) throw new Error('usePush needs a PushProvider');
  return api;
}

export interface PushProviderProps {
  readonly port: PushPort;
  readonly device: DeviceFacts;
  readonly preferences?: PreferencesPort;
  readonly children: ReactNode;
}

type Prompt = { readonly source: 'moment' | 'settings' } | null;

const TICKET_PATH = /^\/tickets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function PushProvider({
  port,
  device,
  preferences = serverPreferencesUnavailable,
  children,
}: PushProviderProps) {
  const core = useCore();
  const session = useSession();
  const { locale } = useLocaleSettings();
  const router = useRouter();
  const pathname = usePathname();
  const navReady = Boolean(useRootNavigationState()?.key);

  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [banner, setBanner] = useState<IncomingPush | null>(null);

  const localeRef = useRef<string>(locale);
  localeRef.current = locale;
  const signedIn = session.status === 'signedIn';
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  const registrar = useMemo(
    () =>
      createPushRegistrar({
        port,
        api: core.api,
        storage: core.storage,
        device,
        locale: () => localeRef.current,
        userId: () => {
          const s = core.session.state;
          return s.status === 'signedIn' ? s.user.id : null;
        },
      }),
    [port, core, device],
  );

  const t = useTranslations('push');
  const channelName = t('channel.name');
  useEffect(() => port.setChannelName?.(channelName), [port, channelName]);

  const refreshPermission = useCallback(async () => {
    const p = await port.getPermission();
    setPermission(p);
    return p;
  }, [port]);

  // ---- Registration ------------------------------------------------------------------------

  useEffect(() => {
    void refreshPermission();
    const sub = AppState.addEventListener('change', (state) => {
      // Back from the phone's settings, or from the background: the answer may have changed.
      if (state === 'active') void refreshPermission().then(() => registrar.sync());
    });
    return () => sub.remove();
  }, [refreshPermission, registrar]);

  // Signing in, a new language, or the phone's permission turning on: register or refresh.
  useEffect(() => {
    if (signedIn) void registrar.sync();
  }, [signedIn, locale, permission, registrar]);

  useEffect(() => registrar.watchToken(), [registrar]);

  // The registration is deleted while the tokens still work (`beforeSignOut`).
  useEffect(() => core.session.beforeSignOut(() => registrar.unregister()), [core, registrar]);

  // ---- Asking ------------------------------------------------------------------------------

  const queue = useRef<Promise<void>>(Promise.resolve());
  const handleMoment = useCallback(
    async (moment: PushMoment) => {
      let state = await loadPromptState(core.storage);
      if (moment === 'purchase_completed') state = afterPurchase(state);
      const current = await refreshPermission();
      const decision = decidePrompt(moment, current, state);
      await savePromptState(core.storage, decision.state);
      // The person may now have an order or a ticket in an organization the phone was not stored in.
      if (current === 'granted' && signedInRef.current) void registrar.sync({ force: true });
      if (decision.ask) setPrompt({ source: 'moment' });
    },
    [core, refreshPermission, registrar],
  );

  useEffect(
    () =>
      onPushMoment((moment) => {
        queue.current = queue.current.then(() => handleMoment(moment)).catch(() => {});
      }),
    [handleMoment],
  );

  // A ticket on screen is the second moment. Only the first time ever asks; the rest are free.
  useEffect(() => {
    if (TICKET_PATH.test(pathname)) reportPushMoment('ticket_opened');
  }, [pathname]);

  const allow = useCallback(async () => {
    setPrompt(null);
    const result = await port.requestPermission();
    setPermission(result);
    if (result === 'granted' && signedInRef.current) void registrar.sync({ force: true });
  }, [port, registrar]);

  const notNow = useCallback(async () => {
    const was = prompt;
    setPrompt(null);
    if (was?.source !== 'moment') return;
    await savePromptState(core.storage, afterNotNow(await loadPromptState(core.storage)));
  }, [core, prompt]);

  // ---- Opening -----------------------------------------------------------------------------

  const ledger = useRef(createTapLedger()).current;
  const waiting = useRef<IncomingPush[]>([]);
  const open = useCallback(
    (push: IncomingPush) => {
      if (!ledger.first(push.id)) return;
      const target = hrefForPush(push, signedInRef.current);
      if (target) router.push(target.href as never);
    },
    [ledger, router],
  );

  const openWhenReady = useCallback(
    (push: IncomingPush) => {
      if (navReady) open(push);
      else waiting.current.push(push);
    },
    [navReady, open],
  );

  useEffect(() => {
    if (!navReady) return;
    for (const push of waiting.current.splice(0)) open(push);
  }, [navReady, open]);

  useEffect(() => port.onTap(openWhenReady), [port, openWhenReady]);

  // The push that launched the app, once the router is up.
  const launchChecked = useRef(false);
  useEffect(() => {
    if (!navReady || launchChecked.current) return;
    launchChecked.current = true;
    void port.takeLaunchPush().then((push) => push && open(push));
  }, [navReady, port, open]);

  // ---- Resuming a link that needed sign-in -------------------------------------------------

  useEffect(() => {
    if (!signedIn || !navReady) return;
    const href = takePendingHref();
    if (href) router.push(href as never);
  }, [signedIn, navReady, router]);

  // ---- Foreground banner -------------------------------------------------------------------

  useEffect(() => port.onForeground(setBanner), [port]);

  const api = useMemo<PushApi>(
    () => ({
      permission,
      preferences,
      askFromSettings: () => setPrompt({ source: 'settings' }),
      openSystemSettings: () => port.openSystemSettings(),
    }),
    [permission, preferences, port],
  );

  return (
    <PushContext.Provider value={api}>
      {children}
      <PrePrompt
        visible={prompt !== null}
        remembers={prompt?.source === 'moment'}
        onAllow={() => void allow()}
        onNotNow={() => void notNow()}
      />
      {banner ? (
        <ForegroundBanner
          key={banner.id}
          title={banner.title}
          body={banner.body}
          openable={routeForPush(banner.data) !== null}
          onOpen={() => {
            const push = banner;
            setBanner(null);
            open(push);
          }}
          onDismiss={() => setBanner(null)}
        />
      ) : null}
    </PushContext.Provider>
  );
}
