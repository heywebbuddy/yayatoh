/**
 * Privacy labels as data (M7.5a). `apps/<app>/store/privacy.json` holds what the App Store privacy
 * labels and the Play Data safety form must say, derived from the SDKs and permissions the app
 * actually ships. `checkPrivacy` fails when the dependency list or the permission list no longer
 * matches that file, so a data-collecting library cannot be added or removed without a decision.
 *
 * Nothing here talks to a store. The owner copies the answers into App Store Connect and Play
 * Console by hand (docs/runbooks/mobile-release.md).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DataType {
  /** App Store Connect: "Category / Data type". */
  readonly apple: string;
  /** Play Console: "Category / Data type". */
  readonly play: string;
  readonly linkedToUser: boolean;
  /** Only when the person uses the feature that needs it (false = always collected). */
  readonly optional: boolean;
  readonly purposes: readonly string[];
  /** `first-party` (sent to Yayatoh's API) and/or the dependency that collects it. */
  readonly via: readonly string[];
  readonly why: string;
}

export interface Privacy {
  readonly app: string;
  readonly reviewedOn: string;
  /** Apple "Used to track you": no advertising, no data broker, no cross-app tracking. */
  readonly tracking: boolean;
  readonly dataTypes: Readonly<Record<string, DataType>>;
  readonly dependencies: Readonly<
    Record<string, { readonly collects: readonly string[]; readonly why: string }>
  >;
  readonly permissions: Readonly<
    Record<string, { readonly dataTypes: readonly string[]; readonly why: string }>
  >;
  readonly play: {
    readonly encryptedInTransit: boolean;
    readonly deletionPath: string;
    readonly processors: readonly string[];
  };
}

/** The Apple data types and Play data types the labels may use (the stores' own lists, as of 2026-10). */
export const APPLE_DATA_TYPES = [
  'Contact Info / Name',
  'Contact Info / Email Address',
  'Contact Info / Phone Number',
  'Identifiers / User ID',
  'Identifiers / Device ID',
  'Purchases / Purchase History',
  'Location / Coarse Location',
  'Location / Precise Location',
  'User Content / Other User Content',
  'Diagnostics / Crash Data',
  'Diagnostics / Performance Data',
  'Diagnostics / Other Diagnostic Data',
] as const;

export const PLAY_DATA_TYPES = [
  'Personal info / Name',
  'Personal info / Email address',
  'Personal info / Phone number',
  'Personal info / User IDs',
  'Device or other IDs / Device or other IDs',
  'Financial info / Purchase history',
  'Location / Approximate location',
  'Location / Precise location',
  'App activity / Other user-generated content',
  'App info and performance / Crash logs',
  'App info and performance / Diagnostics',
] as const;

export const PURPOSES = [
  'app_functionality',
  'account_management',
  'analytics',
  'developer_communications',
  'fraud_prevention_security',
  'diagnostics',
] as const;

/**
 * Libraries known to collect data. If one of them is a dependency, its `collects` list must name
 * at least these data types (and the types must be labelled).
 */
export const KNOWN_COLLECTORS: Readonly<Record<string, readonly string[]>> = {
  '@sentry/react-native': ['crash_data'],
  'expo-notifications': ['device_id'],
  'expo-location': ['location_coarse'],
};

/**
 * Names that suggest analytics, advertising, attribution or crash tooling. A dependency matching
 * this must say what it collects: an empty `collects` is refused, so such a library cannot be
 * added with a "collects nothing" note by mistake.
 */
export const COLLECTOR_NAME =
  /analytics|sentry|firebase|crashlytics|bugsnag|datadog|amplitude|mixpanel|segment|appsflyer|adjust|branch|singular|onesignal|posthog|instabug|facebook|google-mobile-ads|admob|applovin|tracking|telemetry|clarity|heap|rudder|stat(?:s|sig)|logrocket|fullstory|smartlook/i;

/** `@yayatoh/*` packages whose dependencies do not reach the app bundle (only a named export does). */
export const TOKENS_ONLY = new Set(['@yayatoh/ui', '@yayatoh/config']);

/** Config plugins that add a permission at prebuild, which the `app.config.ts` fields do not show. */
export const PLUGIN_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  'expo-calendar': ['ios:NSCalendarsWriteOnlyAccessUsageDescription'],
};

interface PkgJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

function readPkg(dir: string): PkgJson {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PkgJson;
}

/** The workspace packages by name (`packages/*`), so a walk can follow `@yayatoh/*` dependencies. */
function workspaceDirs(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const parent of ['packages', 'apps', 'tools']) {
    const base = join(root, parent);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const dir = join(base, entry);
      if (existsSync(join(dir, 'package.json'))) {
        const name = readPkg(dir).name;
        if (name) out.set(name, dir);
      }
    }
  }
  return out;
}

/**
 * Every third-party package an app ships: its own `dependencies` and those of the workspace
 * packages it uses (`@yayatoh/*`, followed recursively, except those that only export tokens).
 */
export function shippedDependencies(root: string, app: string): string[] {
  const dirs = workspaceDirs(root);
  const seen = new Set<string>();
  const external = new Set<string>();
  const visit = (dir: string): void => {
    for (const name of Object.keys(readPkg(dir).dependencies ?? {})) {
      if (name.startsWith('@yayatoh/')) {
        if (TOKENS_ONLY.has(name) || seen.has(name)) continue;
        seen.add(name);
        const next = dirs.get(name);
        if (next) visit(next);
      } else external.add(name);
    }
  };
  visit(join(root, 'apps', app));
  return [...external].sort();
}

/** The permissions the app asks for, as `ios:NS…UsageDescription` and `android:android.permission.…`. */
export function declaredPermissions(config: {
  readonly ios?: { readonly infoPlist?: Record<string, unknown> };
  readonly android?: { readonly permissions?: readonly string[] };
  readonly plugins?: readonly unknown[];
}): string[] {
  const out = new Set<string>();
  for (const k of Object.keys(config.ios?.infoPlist ?? {}))
    if (/^NS\w+UsageDescription$/.test(k)) out.add(`ios:${k}`);
  for (const p of config.android?.permissions ?? []) out.add(`android:${p}`);
  for (const plugin of config.plugins ?? []) {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    for (const perm of PLUGIN_PERMISSIONS[String(name)] ?? []) out.add(perm);
  }
  return [...out].sort();
}

export interface PrivacyInput {
  readonly privacy: Privacy;
  /** From `shippedDependencies`. */
  readonly dependencies: readonly string[];
  /** From `declaredPermissions`. */
  readonly permissions: readonly string[];
}

/** Problems found; empty means the labels match the dependency and permission lists. */
export function checkPrivacy({ privacy, dependencies, permissions }: PrivacyInput): string[] {
  const errors: string[] = [];
  const have = new Set(dependencies);
  const types = privacy.dataTypes;

  for (const [id, t] of Object.entries(types)) {
    if (!(APPLE_DATA_TYPES as readonly string[]).includes(t.apple))
      errors.push(`dataTypes.${id}: "${t.apple}" is not an App Store data type`);
    if (!(PLAY_DATA_TYPES as readonly string[]).includes(t.play))
      errors.push(`dataTypes.${id}: "${t.play}" is not a Play data type`);
    if (t.purposes.length === 0) errors.push(`dataTypes.${id}: give at least one purpose`);
    for (const p of t.purposes)
      if (!(PURPOSES as readonly string[]).includes(p))
        errors.push(`dataTypes.${id}: unknown purpose "${p}"`);
    if (t.via.length === 0) errors.push(`dataTypes.${id}: say who collects it (first-party or a dependency)`);
    for (const v of t.via) {
      if (v === 'first-party') continue;
      if (!have.has(v))
        errors.push(
          `dataTypes.${id}: collected via ${v}, which is no longer a dependency: remove it from the label or restore the dependency`,
        );
      else if (!privacy.dependencies[v]?.collects.includes(id))
        errors.push(`dataTypes.${id}: via ${v}, but dependencies.${v}.collects does not list it`);
    }
  }

  for (const name of dependencies)
    if (!privacy.dependencies[name])
      errors.push(
        `dependency ${name} is not reviewed: add it to privacy.json (collects: [] if it collects nothing) and update the labels if it collects data`,
      );
  for (const name of Object.keys(privacy.dependencies))
    if (!have.has(name))
      errors.push(
        `dependencies.${name} is no longer a dependency: remove it, and remove its data types from the labels if nothing else collects them`,
      );

  for (const [name, entry] of Object.entries(privacy.dependencies)) {
    for (const id of entry.collects) {
      const t = types[id];
      if (!t) errors.push(`dependencies.${name}: collects "${id}", which has no label in dataTypes`);
      else if (!t.via.includes(name))
        errors.push(`dependencies.${name}: collects "${id}", but dataTypes.${id}.via does not list ${name}`);
    }
    if (!have.has(name)) continue;
    const required = KNOWN_COLLECTORS[name] ?? [];
    for (const id of required)
      if (!entry.collects.includes(id))
        errors.push(`dependencies.${name}: is known to collect "${id}": list it and label it`);
    if (COLLECTOR_NAME.test(name) && entry.collects.length === 0)
      errors.push(
        `dependencies.${name}: the name suggests it collects data; say what it collects (or rename the check if it does not)`,
      );
  }

  const declared = new Set(permissions);
  for (const perm of permissions)
    if (!privacy.permissions[perm])
      errors.push(`permission ${perm} is not reviewed: add it to privacy.json permissions`);
  for (const [perm, entry] of Object.entries(privacy.permissions)) {
    if (!declared.has(perm))
      errors.push(`permissions.${perm} is no longer declared by app.config.ts: remove it from privacy.json`);
    for (const id of entry.dataTypes)
      if (!types[id]) errors.push(`permissions.${perm}: data type "${id}" has no label`);
  }

  if (privacy.tracking) errors.push('tracking must be false: the apps do not track (no ATT prompt)');
  if (!privacy.play.encryptedInTransit) errors.push('play.encryptedInTransit must be true');
  if (!privacy.play.deletionPath)
    errors.push('play.deletionPath: say where the person deletes their account');
  return errors;
}
