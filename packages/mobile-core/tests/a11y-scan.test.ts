/**
 * The static accessibility scan has to fail when something is wrong, or a green app test means
 * nothing. Each snippet below breaks one rule on purpose; the clean one must pass.
 */
import { describeFindings, type ScanConfig, scanSource } from './support/a11y-scan';

const CONFIG: ScanConfig = {
  kitFiles: ['src/kit.tsx'],
  isScreenFile: (file) => file.startsWith('src/app/'),
  fieldComponents: ['Field'],
  colourFiles: ['src/theme.ts'],
  allow: { 'raw-control src/app/allowed.tsx': 'a documented exception' },
};

const scan = (code: string, file = 'src/app/screen.tsx') => describeFindings(scanSource(file, code, CONFIG));
const rn = "import { Pressable, Switch, Text, TextInput, Image, StyleSheet } from 'react-native';\n";

describe('the static accessibility scan', () => {
  it('passes a clean screen', () => {
    expect(
      scan(`${rn}
const styles = StyleSheet.create({ row: { marginStart: 8, paddingEnd: 4, textAlign: 'auto' } });
export const A = () => (
  <Text style={styles.row}>Hello</Text>
);`),
    ).toEqual([]);
  });

  it.each([
    [
      'left in a style sheet',
      'const s = StyleSheet.create({ a: { left: 4 } });',
      /physical-style .*left is physical/,
    ],
    [
      'right in an inline style',
      'const A = () => <Text style={{ right: 4 }}>x</Text>;',
      /physical-style .*right is physical/,
    ],
    ['marginLeft', 'const s = StyleSheet.create({ a: { marginLeft: 4 } });', /marginLeft is physical/],
    ['paddingRight', 'const s = StyleSheet.create({ a: { paddingRight: 4 } });', /paddingRight is physical/],
    [
      'borderLeftWidth',
      'const s = StyleSheet.create({ a: { borderLeftWidth: 1 } });',
      /borderLeftWidth is physical/,
    ],
    [
      'borderTopLeftRadius',
      'const s = StyleSheet.create({ a: { borderTopLeftRadius: 1 } });',
      /borderTopLeftRadius is physical/,
    ],
    [
      'textAlign left',
      "const s = StyleSheet.create({ a: { textAlign: 'left' } });",
      /textAlign 'left' does not mirror/,
    ],
    [
      'textAlign right',
      "const s = StyleSheet.create({ a: { textAlign: 'right' } });",
      /textAlign 'right' does not mirror/,
    ],
    ['row-reverse', "const s = StyleSheet.create({ a: { flexDirection: 'row-reverse' } });", /row-reverse/],
    [
      'a fixed writing direction',
      "const s = StyleSheet.create({ a: { writingDirection: 'ltr' } });",
      /writingDirection/,
    ],
    [
      'text that cannot grow',
      'const A = () => <Text allowFontScaling={false}>x</Text>;',
      /allowFontScaling=\{false\}/,
    ],
    [
      'a low font cap',
      'const A = () => <Text maxFontSizeMultiplier={1.2}>x</Text>;',
      /maxFontSizeMultiplier 1.2 is below 1.5/,
    ],
    ['shrink to fit', 'const A = () => <Text adjustsFontSizeToFit>x</Text>;', /adjustsFontSizeToFit/],
    ['a line limit', 'const A = () => <Text numberOfLines={1}>x</Text>;', /numberOfLines/],
    [
      'a Pressable with no role',
      'const A = () => <Pressable accessibilityLabel="Go" onPress={f} />;',
      /no accessibilityRole/,
    ],
    [
      'a Pressable with no label',
      'const A = () => <Pressable accessibilityRole="button" onPress={f}><Text>Go</Text></Pressable>;',
      /no accessibilityLabel/,
    ],
    [
      'a Switch with no label',
      'const A = () => <Switch accessibilityRole="switch" />;',
      /Switch has no accessibilityLabel/,
    ],
    ['a TextInput with no label', 'const A = () => <TextInput />;', /TextInput has no accessibilityLabel/],
    ['text that is a button', 'const A = () => <Text onPress={f}>Go</Text>;', /Text with onPress/],
    ['an image with no description', 'const A = () => <Image source={x} />;', /Image has no alt text/],
    [
      'a field without autofill',
      'const A = () => <Field label="x" />;',
      /field-autofill .*Field says neither/,
    ],
    ['a hex colour', "const s = StyleSheet.create({ a: { color: '#ff0000' } });", /colour .*#ff0000/],
    [
      'a named colour',
      "const s = StyleSheet.create({ a: { backgroundColor: 'white' } });",
      /colour .*backgroundColor: 'white'/,
    ],
    ['an rgb colour', "const c = 'rgba(0, 0, 0, 0.5)';", /colour .*rgba/],
    ['an arrow in text', 'const A = () => <Text>Next →</Text>;', /direction-glyph/],
    ['a chevron in a string', "const label = 'Back ‹';", /direction-glyph/],
  ] as const)('flags %s', (_name, body, expected) => {
    const code = `${rn}${body}`;
    expect(scan(code).join('\n')).toMatch(expected);
  });

  it('flags a raw control in a screen, but not in the kit', () => {
    const code = `${rn}export const A = () => <Pressable accessibilityRole="button" accessibilityLabel="Go" onPress={f} />;`;
    expect(scan(code, 'src/app/screen.tsx').join()).toMatch(/raw-control/);
    expect(scan(code, 'src/kit.tsx')).toEqual([]);
    expect(scan(code, 'src/app/allowed.tsx')).toEqual([]);
  });

  it('does not mistake data for styles', () => {
    expect(scan("const x = { kind: 'attempts', left: 3 }; type T = { left: number | null };")).toEqual([]);
    expect(scan(`${rn}const A = () => <Text style={{ left: 1 }} />;`).join()).toMatch(/left is physical/);
  });

  it('accepts a cap of 1.5 or more, a multiline box and a field that decides about autofill', () => {
    expect(
      scan(
        `${rn}const A = () => (<><Text maxFontSizeMultiplier={2}>x</Text>
        <TextInput accessibilityLabel="Notes" multiline numberOfLines={3} />
        <Field label="x" autoComplete="off" /></>);`,
        'src/kit.tsx',
      ),
    ).toEqual([]);
  });

  it('lets the theme file hold colours', () => {
    expect(scan("export const white = '#ffffff';", 'src/theme.ts')).toEqual([]);
    expect(scan("export const white = '#ffffff';", 'src/other.ts').join()).toMatch(/colour/);
  });

  it("ignores a Button that is not React Native's", () => {
    expect(
      scan('import { Button } from \'./kit\';\nexport const A = () => <Button label="Go" onPress={f} />;'),
    ).toEqual([]);
  });
});
