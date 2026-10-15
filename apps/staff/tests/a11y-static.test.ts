/**
 * The static accessibility audit of the staff app (M7.X): the source is parsed (not searched
 * with a pattern) and must not contain what a larger font, a screen reader or Arabic breaks.
 * The rules and their exceptions are described in `packages/mobile-core/tests/support/a11y-scan.ts`;
 * the scanner itself is tested in `packages/mobile-core/tests/a11y-scan.test.ts`.
 *
 * The shared package `packages/mobile-core/src` is scanned here too: both apps run on it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  describeFindings,
  type Finding,
  type ScanConfig,
  scanSource,
} from '@yayatoh/mobile-core/testing/a11y-scan';

const REPO = join(__dirname, '../../..');
const ROOTS = ['apps/staff/src', 'packages/mobile-core/src'];

const CONFIG: ScanConfig = {
  // The three kits that own the role, the name and the 44 points of every control the screens use.
  kitFiles: [
    'apps/staff/src/ui/kit.tsx',
    'apps/staff/src/tools/ui.tsx',
    'apps/staff/src/scan/ui/controls.tsx',
  ],
  // The routes, the door-tool screens and the scan screen's parts are screens; they compose the kits.
  isScreenFile: (file) =>
    file.startsWith('apps/staff/src/app/') ||
    file.startsWith('apps/staff/src/tools/screens/') ||
    file.startsWith('apps/staff/src/scan/ui/'),
  fieldComponents: ['Field', 'TextField'],
  colourFiles: [
    'packages/mobile-core/src/theme/theme.ts',
    'packages/mobile-core/src/theme/contrast.ts',
    'packages/mobile-core/src/theme/provider.tsx',
  ],
  allow: {
    'raw-control apps/staff/src/scan/ui/manual-entry.tsx':
      "The ticket code field turns autofill and the keyboard's learning off, writes in capitals and in large type; the kit's TextField offers none of that. It has a label, a hint, an error that is announced and 48 points.",
  },
};

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });

const files = ROOTS.flatMap((root) => sources(join(REPO, root)));
const findings: Finding[] = files.flatMap((path) =>
  scanSource(relative(REPO, path).split(sep).join('/'), readFileSync(path, 'utf8'), CONFIG),
);
const of = (rule: Finding['rule']) => describeFindings(findings.filter((f) => f.rule === rule));

describe('the staff app source (static accessibility audit)', () => {
  it('scans the whole app and the shared package', () => {
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((f) => f.endsWith(join('scan', 'ui', 'scan-screen.tsx')))).toBe(true);
    expect(files.some((f) => f.endsWith(join('version', 'components.tsx')))).toBe(true);
  });

  it('uses logical styles only: start/end, never left/right, so Arabic mirrors', () => {
    expect(of('physical-style')).toEqual([]);
  });

  it('lets text grow: no allowFontScaling={false}, no cap under 1.5, no shrink-to-fit, no cut-off lines', () => {
    expect(of('font-scaling')).toEqual([]);
  });

  it('gives every control a role and a name, every field a label, every image a description', () => {
    expect(of('control')).toEqual([]);
  });

  it('gives every field an autofill hint (textContentType or autoComplete)', () => {
    expect(of('field-autofill')).toEqual([]);
  });

  it('builds screens from the kit: no raw Pressable, TextInput or Switch in a route file', () => {
    expect(of('raw-control')).toEqual([]);
  });

  it('takes every colour from the tokens: no hex, rgb or named colour outside the theme', () => {
    expect(of('colour')).toEqual([]);
  });

  it('draws no arrows or chevrons as text (they would point the wrong way in Arabic)', () => {
    expect(of('direction-glyph')).toEqual([]);
  });
});
