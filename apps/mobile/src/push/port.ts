/**
 * The seam between the app's push logic and the phone (M7.3d). Everything that needs
 * `expo-notifications` or the system settings sits behind `PushPort`, with an Expo adapter for the
 * app (`expo-port.ts`) and a fake for tests, so the prompt rules, the registration and the routing
 * run under Jest without APNs or FCM.
 */

/** What the phone says about the notification permission. */
export type PushPermission = 'undetermined' | 'granted' | 'denied';

/** The phone's push token for this install. APNs tokens are hex, FCM tokens are url-safe text. */
export interface DevicePushToken {
  readonly platform: 'apns' | 'fcm';
  readonly token: string;
}

/**
 * A notification as the app sees it. `title` and `body` are the server's allowlisted text (event
 * name and what changed); `data` is the payload object (`path`, `lang`).
 */
export interface IncomingPush {
  /** Stable per notification, so a tap handled once is not handled again. */
  readonly id: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly data: unknown;
}

export interface PushPort {
  /** The Android channel's name in the phone's settings, in the app's language. Optional. */
  setChannelName?(name: string): void;
  getPermission(): Promise<PushPermission>;
  /** Shows the system sheet (or answers at once when the phone already decided). */
  requestPermission(): Promise<PushPermission>;
  /** Null when the phone cannot give a token (a simulator, no Google services, no permission). */
  getDeviceToken(): Promise<DevicePushToken | null>;
  /** The OS rotated the token. Returns its remover. */
  onTokenChange(listener: (token: DevicePushToken) => void): () => void;
  /** A notification arrived while the app is in the foreground. Returns its remover. */
  onForeground(listener: (push: IncomingPush) => void): () => void;
  /** A notification was tapped while the app was running (warm start or foreground). */
  onTap(listener: (push: IncomingPush) => void): () => void;
  /** The notification that launched the app from a closed state, once. */
  takeLaunchPush(): Promise<IncomingPush | null>;
  /** Opens this app's page in the phone's settings. */
  openSystemSettings(): Promise<void>;
}

/** An inert port for platforms with no push (web previews) and for tests that do not care. */
export function unavailablePushPort(): PushPort {
  return {
    getPermission: async () => 'denied',
    requestPermission: async () => 'denied',
    getDeviceToken: async () => null,
    onTokenChange: () => () => {},
    onForeground: () => () => {},
    onTap: () => () => {},
    takeLaunchPush: async () => null,
    openSystemSettings: async () => {},
  };
}
