/**
 * The accessibility audit has to fail when something is wrong, or a green screen test means
 * nothing. Each case below breaks one rule on purpose.
 */
import { render, screen } from '@testing-library/react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { announcements, auditTree, hasArabicLetters, MIN_TOUCH } from './support/a11y-audit';

const env = { flatten: (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown> };
const audit = () => auditTree(screen.UNSAFE_root, env).problems;
const inScroll = (ui: React.ReactNode) => <ScrollView>{ui}</ScrollView>;

describe('the rendered accessibility audit', () => {
  it('passes a well-made screen', () => {
    render(
      inScroll(
        <>
          <Text accessibilityRole="header">Title</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go"
            onPress={() => {}}
            style={{ minHeight: MIN_TOUCH }}
          >
            <Text>Go</Text>
          </Pressable>
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel="One"
            accessibilityState={{ checked: true }}
            onPress={() => {}}
            style={{ minHeight: MIN_TOUCH }}
          >
            <Text>One</Text>
          </Pressable>
          <View style={{ minHeight: MIN_TOUCH }}>
            <Switch
              accessibilityRole="switch"
              accessibilityLabel="Reminders"
              value
              onValueChange={() => {}}
            />
          </View>
        </>,
      ),
    );
    const result = auditTree(screen.UNSAFE_root, env);
    expect(result.problems).toEqual([]);
    expect(result.controls).toBe(3);
    expect(result.headers).toBe(1);
  });

  it.each([
    [
      'a control without a name',
      <Pressable key="a" accessibilityRole="button" onPress={() => {}} style={{ minHeight: 44 }} />,
      /no accessible name/,
    ],
    [
      'a control without a role',
      <Pressable key="a" accessibilityLabel="Go" onPress={() => {}} style={{ minHeight: 44 }} />,
      /no accessibilityRole/,
    ],
    [
      'a target under 44 points',
      <Pressable
        key="a"
        accessibilityRole="button"
        accessibilityLabel="Go"
        onPress={() => {}}
        style={{ minHeight: 30 }}
      />,
      /30 points high is smaller than 44/,
    ],
    [
      'a target saved by hit slop',
      <Pressable
        key="a"
        accessibilityRole="button"
        accessibilityLabel="Go"
        onPress={() => {}}
        hitSlop={8}
        style={{ minHeight: 30 }}
      >
        <Text>Go</Text>
      </Pressable>,
      null,
    ],
    [
      'a target with no height at all',
      <Pressable key="a" accessibilityRole="button" accessibilityLabel="Go" onPress={() => {}} />,
      /no explicit minHeight/,
    ],
    [
      'an icon-only control that is narrow',
      <Pressable
        key="a"
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => {}}
        style={{ minHeight: 44, width: 20 }}
      />,
      /icon-only control is narrower/,
    ],
    [
      'a radio that does not say if it is chosen',
      <Pressable
        key="a"
        accessibilityRole="radio"
        accessibilityLabel="One"
        onPress={() => {}}
        style={{ minHeight: 44 }}
      />,
      /does not say whether it is checked/,
    ],
    [
      'a switch whose row is small',
      <Switch key="a" accessibilityRole="switch" accessibilityLabel="Reminders" value />,
      /switch row is not 44 points high/,
    ],
    [
      'text that cannot grow',
      <Text key="a" allowFontScaling={false}>
        Fixed
      </Text>,
      /allowFontScaling is off/,
    ],
    [
      'a low cap on the text size',
      <Text key="a" maxFontSizeMultiplier={1.2}>
        Capped
      </Text>,
      /maxFontSizeMultiplier 1.2 is below 1.5/,
    ],
    [
      'a fixed height around text',
      <View key="a" style={{ height: 40 }}>
        <Text>Clipped when large</Text>
      </View>,
      /fixed height of 40 would clip/,
    ],
    ['an image with no description', <View key="a" accessibilityRole="image" />, /image has no description/],
    [
      'a control hidden by its parent',
      <View key="a" importantForAccessibility="no-hide-descendants">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go"
          onPress={() => {}}
          style={{ minHeight: 44 }}
        />
      </View>,
      /hidden from screen readers by an ancestor/,
    ],
    [
      'an error that is not linked to its field',
      <View key="a">
        <TextInput accessibilityLabel="Email" style={{ minHeight: 44 }} />
        <Text accessibilityRole="alert">Enter an address</Text>
      </View>,
      /not linked to its field/,
    ],
    [
      'a modal that does not trap focus',
      <Modal key="a" visible>
        <Text>Hello</Text>
      </Modal>,
      /modal does not set accessibilityViewIsModal/,
    ],
  ] as const)('%s', (_name, ui, expected) => {
    render(inScroll(ui));
    const problems = audit();
    if (expected === null) expect(problems).toEqual([]);
    else expect(problems.join('\n')).toMatch(expected);
  });

  it('wants the screen to scroll, unless it says why not', () => {
    render(<Text>Short</Text>);
    expect(audit().join()).toMatch(/no scrolling container/);
    expect(auditTree(screen.UNSAFE_root, env, { fixedLayout: 'a camera' }).problems).toEqual([]);
  });

  it('reads announcements from alerts and live regions only', () => {
    render(
      <>
        <Text accessibilityRole="alert">Failed</Text>
        <Text accessibilityLiveRegion="polite">Saved</Text>
        <Text>Quiet</Text>
      </>,
    );
    expect(announcements(screen.UNSAFE_root)).toEqual(['Failed', 'Saved']);
  });

  it('tells Arabic text from English', () => {
    expect(hasArabicLetters('تسجيل الدخول')).toBe(true);
    expect(hasArabicLetters('Sign in')).toBe(false);
  });
});
