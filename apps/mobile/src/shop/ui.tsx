/**
 * The few building blocks of the shopping screens (M7.3c): every colour, space and radius comes from
 * the design tokens through `useColors`; every control has a role, a label and a 44 pt target; text
 * wraps and nothing has a fixed height, so the largest system font still fits; alignment is logical
 * (`textAlign: 'auto'`, `start`/`end`), so Arabic mirrors.
 */
import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '@yayatoh/mobile-core';
import type { ReactNode } from 'react';
import {
  type AccessibilityRole,
  ActivityIndicator,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const MIN_TARGET = Math.max(TOUCH_TARGET_PX, 44);

type Edge = 'top' | 'right' | 'bottom' | 'left';

/**
 * A screen that is not a list: the canvas inside the safe area, with a scroll view so the content
 * stays reachable at the largest system font size (a state like "loading" or "not found" is short
 * today and long in Arabic at 200 %).
 */
export function Page({
  children,
  edges,
  testID,
}: {
  children: ReactNode;
  edges?: readonly Edge[];
  testID?: string;
}) {
  const colors = useColors();
  return (
    <SafeAreaView edges={edges} style={[styles.page, { backgroundColor: colors.canvas }]} testID={testID}>
      <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Heading({ children, level = 1 }: { children: ReactNode; level?: 1 | 2 }) {
  const colors = useColors();
  return (
    <Text accessibilityRole="header" style={[level === 1 ? styles.h1 : styles.h2, { color: colors.ink }]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  strong = false,
  testID,
}: {
  children: ReactNode;
  muted?: boolean;
  strong?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Text
      testID={testID}
      style={[styles.body, strong && styles.strong, { color: muted ? colors.ink2 : colors.ink }]}
    >
      {children}
    </Text>
  );
}

export function Caption({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useColors();
  return (
    <Text testID={testID} style={[styles.caption, { color: colors.ink2 }]}>
      {children}
    </Text>
  );
}

export function Card({
  children,
  testID,
  style,
}: {
  children: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }, style]}
    >
      {children}
    </View>
  );
}

export type ButtonTone = 'primary' | 'secondary';

export function Button({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
  busy = false,
  hint,
  testID,
}: {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
  testID?: string;
}) {
  const colors = useColors();
  const inactive = disabled || busy;
  const primary = tone === 'primary';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary
            ? inactive
              ? colors.surface3
              : pressed
                ? colors.primaryPressed
                : colors.primary
            : pressed
              ? colors.surface3
              : colors.surface2,
          borderColor: primary ? 'transparent' : colors.lineStrong,
        },
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? colors.onPrimary : colors.ink} /> : null}
      <Text
        style={[
          styles.buttonLabel,
          {
            color: primary
              ? inactive
                ? colors.ink3
                : colors.onPrimary
              : inactive
                ? colors.ink3
                : colors.ink,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A toggle chip (category, date preset): selected is shown by fill and by the `selected` state, not colour alone. */
export function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface2,
          borderColor: selected ? colors.primaryInk : colors.lineStrong,
        },
      ]}
    >
      <Text style={[styles.chipLabel, { color: selected ? colors.primaryInk : colors.ink }]}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  error,
  testID,
  ...input
}: TextInputProps & { label: string; error?: string | null; testID?: string }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.ink }]}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        placeholderTextColor={colors.ink3}
        {...input}
        style={[
          styles.input,
          {
            color: colors.ink,
            backgroundColor: colors.surface2,
            borderColor: error ? colors.danger : colors.lineStrong,
            textAlign: 'auto',
          },
        ]}
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.caption, { color: colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export type BannerTone = 'info' | 'warning' | 'danger' | 'success';

/** A message block: tone is a fill plus a leading mark and the text, never colour alone. */
export function Banner({
  tone,
  title,
  children,
  action,
  testID,
  heading = false,
}: {
  tone: BannerTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  testID?: string;
  /** The banner is the whole message of a screen (an error page): its title is the screen's heading. */
  heading?: boolean;
}) {
  const colors = useColors();
  const fill = {
    info: colors.primarySoft,
    warning: colors.warningSoft,
    danger: colors.dangerSoft,
    success: colors.successSoft,
  }[tone];
  const ink = {
    info: colors.primaryInk,
    warning: colors.warning,
    danger: colors.danger,
    success: colors.success,
  }[tone];
  const mark = { info: 'ℹ', warning: '!', danger: '⚠', success: '✓' }[tone];
  const urgent = tone === 'danger' || tone === 'warning';
  const role: AccessibilityRole = urgent ? 'alert' : 'summary';
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: fill }]}>
      {/* The words are one announcement; the action stays a separate stop, so it can be reached. */}
      <View
        accessible
        accessibilityRole={role}
        accessibilityLiveRegion={urgent ? 'polite' : 'none'}
        style={styles.bannerText}
      >
        <Text accessibilityRole={heading ? 'header' : undefined} style={[styles.bannerTitle, { color: ink }]}>
          <Text accessibilityElementsHidden importantForAccessibility="no">
            {mark}{' '}
          </Text>
          {title}
        </Text>
        {children ? <Text style={[styles.body, { color: colors.ink }]}>{children}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Loading({ label, testID = 'loading' }: { label: string; testID?: string }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={styles.center}
    >
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={[styles.body, { color: colors.ink2 }]}>{label}</Text>
    </View>
  );
}

export function Empty({
  title,
  body,
  action,
  testID = 'empty',
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <View testID={testID} style={styles.center}>
      <Text accessibilityRole="header" style={[styles.h2, styles.centerText, { color: colors.ink }]}>
        {title}
      </Text>
      {body ? <Text style={[styles.body, styles.centerText, { color: colors.ink2 }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  pageContent: { flexGrow: 1, padding: space[4], gap: space[4] },
  h1: {
    fontSize: type.section.size,
    fontWeight: '800',
    lineHeight: type.section.size * type.section.lineHeight,
    textAlign: 'auto',
  },
  h2: {
    fontSize: type.card.size,
    fontWeight: '800',
    lineHeight: type.card.size * type.card.lineHeight,
    textAlign: 'auto',
  },
  body: {
    fontSize: type.body.size + 1,
    lineHeight: (type.body.size + 1) * type.body.lineHeight,
    textAlign: 'auto',
  },
  strong: { fontWeight: '700' },
  caption: {
    fontSize: type.caption.size + 1,
    lineHeight: (type.caption.size + 1) * type.caption.lineHeight,
    textAlign: 'auto',
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.tile),
    padding: space[4],
    gap: space[2],
  },
  button: {
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: px(radius.control),
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space[2],
  },
  buttonLabel: { fontSize: type.body.size + 2, fontWeight: '800', textAlign: 'center' },
  chip: {
    minHeight: MIN_TARGET,
    paddingHorizontal: space[3],
    borderRadius: px(radius.pill),
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: { fontSize: type.body.size, fontWeight: '700', textAlign: 'center' },
  field: { gap: space[1] },
  fieldLabel: { fontSize: type.body.size, fontWeight: '700', textAlign: 'auto' },
  input: {
    minHeight: MIN_TARGET,
    borderWidth: 1,
    borderRadius: px(radius.control),
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontSize: type.body.size + 2,
  },
  banner: { borderRadius: px(radius.tile), padding: space[4], gap: space[2] },
  bannerText: { gap: space[2] },
  bannerTitle: { fontSize: type.body.size + 1, fontWeight: '800', textAlign: 'auto' },
  center: { alignItems: 'center', justifyContent: 'center', padding: space[6], gap: space[3] },
  centerText: { textAlign: 'center' },
});
