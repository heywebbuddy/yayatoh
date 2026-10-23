/**
 * The screenshot plan (M7.5a): `apps/<app>/store/screenshots.json` lists the screens to capture,
 * the Maestro flow that lands on each one, the device sizes each store needs, and where the PNGs
 * go. The device pass runs `apps/<app>/store/capture.sh`; nothing here needs a simulator.
 */

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Pixel sizes App Store Connect accepts for the screenshot sets we use (portrait). */
export const APPLE_SIZES: Readonly<Record<string, readonly [number, number]>> = {
  'iphone-6.9': [1320, 2868],
  'iphone-6.5': [1284, 2778],
  'ipad-13': [2064, 2752],
};

/** Google Play: each side 320-3840 px and the long side at most twice the short one. */
export function playSizeOk(w: number, h: number): boolean {
  const [short, long] = w < h ? [w, h] : [h, w];
  return short >= 320 && long <= 3840 && long <= short * 2;
}

export interface ScreenshotPlan {
  readonly app: string;
  readonly outputLayout: string;
  readonly themes: readonly string[];
  readonly locales: readonly string[];
  readonly devices: readonly {
    readonly id: string;
    readonly platform: 'ios' | 'android';
    readonly width: number;
    readonly height: number;
    readonly required: boolean;
  }[];
  readonly screens: readonly {
    readonly id: string;
    readonly flow: string;
    readonly devices: readonly string[];
  }[];
}

export interface PlanInput {
  readonly plan: ScreenshotPlan;
  /** Exists on disk? (relative to the app folder) */
  readonly exists: (appRelativePath: string) => boolean;
  /** Text of a flow file, or null. */
  readonly read: (appRelativePath: string) => string | null;
  /** Staff and the attendee app both run on iPad (`supportsTablet`). */
  readonly supportsTablet: boolean;
}

export function checkScreenshotPlan({ plan, exists, read, supportsTablet }: PlanInput): string[] {
  const errors: string[] = [];
  if (!isObject(plan)) return ['screenshots.json: not an object'];
  if (!plan.themes.includes('light') || !plan.themes.includes('dark')) errors.push('themes: light and dark');
  if (!plan.locales.includes('en')) errors.push('locales: en first');
  if (!/<platform>.*<locale>.*<device>.*<theme>.*<order>-<screen>/.test(plan.outputLayout))
    errors.push('outputLayout: must be <platform>/<locale>/<device>/<theme>/<order>-<screen>.png');

  const ids = new Set<string>();
  for (const d of plan.devices) {
    if (ids.has(d.id)) errors.push(`devices.${d.id}: twice`);
    ids.add(d.id);
    if (d.platform === 'ios') {
      const size = APPLE_SIZES[d.id];
      if (!size) errors.push(`devices.${d.id}: not an App Store screenshot set we know`);
      else if (size[0] !== d.width || size[1] !== d.height)
        errors.push(`devices.${d.id}: App Store wants ${size[0]}x${size[1]}`);
    } else if (!playSizeOk(d.width, d.height))
      errors.push(`devices.${d.id}: ${d.width}x${d.height} breaks Play's size rule`);
  }
  const required = plan.devices.filter((d) => d.required);
  if (!required.some((d) => d.platform === 'ios' && d.id.startsWith('iphone')))
    errors.push('devices: a required iPhone set');
  if (!required.some((d) => d.platform === 'android')) errors.push('devices: a required Android phone set');
  if (supportsTablet && !required.some((d) => d.id === 'ipad-13'))
    errors.push('devices: the app runs on iPad (supportsTablet), so App Store Connect requires an iPad set');

  const screenIds = new Set<string>();
  for (const [i, s] of plan.screens.entries()) {
    if (screenIds.has(s.id)) errors.push(`screens.${s.id}: twice`);
    screenIds.add(s.id);
    if (!/^[a-z0-9-]+$/.test(s.id)) errors.push(`screens.${s.id}: use lowercase letters, digits and hyphens`);
    if (!exists(s.flow)) errors.push(`screens.${s.id}: flow ${s.flow} does not exist`);
    else {
      const text = read(s.flow) ?? '';
      const order = String(i + 1).padStart(2, '0');
      if (!text.includes('takeScreenshot'))
        errors.push(`screens.${s.id}: ${s.flow} never takes a screenshot`);
      if (!text.includes(`${order}-${s.id}`))
        errors.push(`screens.${s.id}: ${s.flow} must save ${order}-${s.id}`);
    }
    for (const d of s.devices) if (!ids.has(d)) errors.push(`screens.${s.id}: unknown device ${d}`);
  }
  // Apple wants at least 2 screenshots per set (up to 10); Play at least 2 per phone set.
  for (const d of required) {
    const n = plan.screens.filter((s) => s.devices.includes(d.id)).length;
    if (n < 3) errors.push(`devices.${d.id}: only ${n} screens, plan at least 3`);
    if (n > 8) errors.push(`devices.${d.id}: ${n} screens, keep to 8 so every listing locale can match`);
  }
  return errors;
}

/** The PNG paths a finished capture run leaves under `<outputRoot>/`, in the documented layout. */
export function expectedShots(plan: ScreenshotPlan, locales: readonly string[] = plan.locales): string[] {
  const out: string[] = [];
  for (const locale of locales)
    for (const device of plan.devices) {
      if (!device.required) continue;
      for (const theme of plan.themes)
        for (const [i, s] of plan.screens.entries()) {
          if (!s.devices.includes(device.id)) continue;
          out.push(
            `${device.platform}/${locale}/${device.id}/${theme}/${String(i + 1).padStart(2, '0')}-${s.id}.png`,
          );
        }
    }
  return out;
}

/** Width and height from a PNG's header (no image library needed); null if it is not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Checks a finished capture folder: every planned PNG exists, is a PNG and has its device's exact
 * size. `read` returns the file's bytes (relative to the output root) or null.
 */
export function checkShots(
  plan: ScreenshotPlan,
  read: (relativePath: string) => Uint8Array | null,
  locales: readonly string[] = plan.locales,
): string[] {
  const errors: string[] = [];
  for (const rel of expectedShots(plan, locales)) {
    const bytes = read(rel);
    if (!bytes) {
      errors.push(`${rel}: missing`);
      continue;
    }
    const size = pngSize(bytes);
    const device = plan.devices.find((d) => rel.split('/')[2] === d.id);
    if (!size) errors.push(`${rel}: not a PNG`);
    else if (device && (size.width !== device.width || size.height !== device.height))
      errors.push(
        `${rel}: ${size.width}x${size.height}, ${device.id} needs ${device.width}x${device.height}`,
      );
  }
  return errors;
}
