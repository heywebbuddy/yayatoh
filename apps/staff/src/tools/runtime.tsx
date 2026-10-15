/**
 * The real `ToolsDeps` (M7.4c): the door tools wired to the app's sessions and the phone. The device
 * session (M7.4a) gives the `yyd_` client, the event and the entrance; the scanner (M7.4b) gives the
 * saved manifest for offline lookup and the offline verdicts; the portal session gives the rep's
 * `yyp_` client; the core session gives the organizer's. Plain adapters sit behind the ports so the
 * screens stay testable.
 */
import { documentFileStore, useCore, useIsOffline, useSession } from '@yayatoh/mobile-core';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useDevice } from '../device';
import { usePortal } from '../portal';
import { ScanUnavailableError } from '../scan/engine';
import { nativeFeedback } from '../scan/feedback';
import { useScanRuntime } from '../scan/provider';
import { QrCamera } from '../scan/ui/qr-camera';
import { viewFor } from '../scan/verdicts';
import { createOpsApi, createPortalApi, createStaffApi } from './api';
import { type OrganizerChoice, type ScannerProps, type ToolsDeps, ToolsProvider } from './deps';
import { nativePush } from './native-push';
import { createVault } from './vault';

const CHOICE_KEY = 'yayatoh.tools.organizer-choice';
const randomBytes = (n: number) => Crypto.getRandomBytes(n);

/** One vault for the app: the key in secure storage, the files in the app's private storage. */
function useVault() {
  const { storage } = useCore();
  return useMemo(() => createVault({ storage, files: documentFileStore(), random: randomBytes }), [storage]);
}

/** Registered once in the root layout: a remote wipe, a revoke or a removal deletes what the tools keep. */
export function ToolsWipe() {
  const device = useDevice();
  const vault = useVault();
  const { onWipe } = device;
  useEffect(() => onWipe(() => vault.wipe()), [onWipe, vault]);
  return null;
}

/** The camera for lead badges: the scanner's own QR camera, with the typed field the screen already has. */
function BadgeCamera({ active, onCode }: ScannerProps) {
  return (
    <QrCamera
      active={active}
      torch={false}
      height={280}
      onCode={onCode}
      onTorchSupport={() => {}}
      onTypeCode={() => {}}
    />
  );
}

const TONE_VERDICT = { ok: 'admit', warn: 'duplicate', stop: 'invalid' } as const;

export function ToolsRuntime({ children }: { children: ReactNode }) {
  const core = useCore();
  const device = useDevice();
  const portal = usePortal();
  const account = useSession();
  const scan = useScanRuntime();
  const router = useRouter();
  const vault = useVault();

  // Lead screens show nothing of one rep to the next: the key changes at every sign-out.
  const [portalKey, setPortalKey] = useState(0);
  const { onSignedOut } = portal;
  useEffect(
    () =>
      onSignedOut(() => {
        setPortalKey((k) => k + 1);
        core.queryClient.removeQueries({ queryKey: ['tools', 'leads'] });
      }),
    [onSignedOut, core],
  );

  // The organizer's chosen event is remembered between launches, and forgotten at sign-out.
  const [choice, setChoice] = useState<OrganizerChoice | null>(null);
  useEffect(() => {
    core.storage.get(CHOICE_KEY).then((raw) => {
      try {
        setChoice(raw ? (JSON.parse(raw) as OrganizerChoice) : null);
      } catch {
        setChoice(null);
      }
    });
  }, [core]);
  const choose = useCallback(
    (next: OrganizerChoice | null) => {
      setChoice(next);
      if (next) void core.storage.set(CHOICE_KEY, JSON.stringify(next));
      else void core.storage.delete(CHOICE_KEY);
    },
    [core],
  );
  useEffect(
    () =>
      core.session.onSignedOut(() => {
        choose(null);
        core.queryClient.removeQueries({ queryKey: ['tools', 'ops'] });
      }),
    [core, choose],
  );

  const enrolled = device.status === 'enrolled' && device.eventId !== null && device.deviceId !== null;
  const deps = useMemo<ToolsDeps>(
    () => ({
      device: enrolled
        ? {
            deviceId: device.deviceId as string,
            eventId: device.eventId as string,
            checkpointId: device.checkpointId,
          }
        : null,
      staff: enrolled ? createStaffApi(device.api) : null,
      portal:
        portal.status === 'signedIn'
          ? { api: createPortalApi(portal.api), sessionKey: String(portalKey) }
          : null,
      organizer: account.status === 'signedIn' ? { api: createOpsApi(core.api), choice, choose } : null,
      manifest: async () => {
        const src = scan?.engine.lookupSource ?? null;
        return src ? { ...src, origin: 'device' as const } : null;
      },
      offlineCheckIn: scan
        ? {
            async scan(code) {
              try {
                const o = await scan.engine.scan(code);
                return { verdict: o.verdict, holderName: o.holderName, typeName: o.typeName };
              } catch (e) {
                if (e instanceof ScanUnavailableError) return null;
                throw e;
              }
            },
          }
        : null,
      vault,
      push: nativePush,
      Scanner: BadgeCamera,
      clock: { now: () => new Date(), offsetMs: () => device.clockOffsetMs },
      newId: () => Crypto.randomUUID(),
      navigate: (path) => router.push(path as never),
      useOffline: useIsOffline,
      feedback: (tone) => nativeFeedback.play(viewFor(TONE_VERDICT[tone])),
    }),
    [enrolled, device, portal, portalKey, account.status, core, choice, choose, scan, vault, router],
  );
  return <ToolsProvider deps={deps}>{children}</ToolsProvider>;
}
