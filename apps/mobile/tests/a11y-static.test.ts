/**
 * The static accessibility audit of the attendee app (M7.X): the source is parsed (not searched
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
} from '../../../packages/mobile-core/tests/support/a11y-scan';

const REPO = join(__dirname, '../../..');
const ROOTS = ['apps/mobile/src', 'packages/mobile-core/src'];

const CONFIG: ScanConfig = {
  // The three kits that own the role, the name and the 44 points of every control the screens use.
  kitFiles: ['apps/mobile/src/auth/ui.tsx', 'apps/mobile/src/tickets/ui.tsx', 'apps/mobile/src/shop/ui.tsx'],
  // Route files are the screens; they compose the kit and never build a raw control themselves.
  isScreenFile: (file) => file.startsWith('apps/mobile/src/app/'),
  fieldComponents: ['Field'],
  colourFiles: [
    'packages/mobile-core/src/theme/theme.ts',
    'packages/mobile-core/src/theme/contrast.ts',
    'packages/mobile-core/src/theme/provider.tsx',
  ],
  allow: {},
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

describe('the attendee app source (static accessibility audit)', () => {
  it('scans the whole app and the shared package', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith(join('app', '(tabs)', 'account.tsx')))).toBe(true);
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
