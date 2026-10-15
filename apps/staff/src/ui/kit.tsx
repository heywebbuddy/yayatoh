/**
 * The small set of controls the enrolment, sign-in and picker screens share (M7.4a): every colour,
 * space, radius and type size comes from the design tokens (light and dark), every control is at
 * least 44 pt tall with a role and a label, and nothing is positioned with left or right, so Arabic
 * reads right to left. On an iPad the content stays in a readable column.
 */
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '../theme';

/** The widest a form grows: a readable column on an iPad, the full width on a phone. */
export const COLUMN_WIDTH = 560;

export function Screen({
  children,
  testID,
  scroll = true,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
  readonly scroll?: boolean;
}) {
  const colors = useColors();
  const body = (
    <View style={styles.column} testID={testID ? `${testID}-column` : undefined}>
      {children}
    </View>
  );
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]} testID={testID}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={styles.scroll}>{body}</View>
      )}
    </SafeAreaView>
  );
}

export function Heading({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  const colors = useColors();
  return (
    <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]} testID={testID}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  testID,
}: {
  readonly children: ReactNode;
  readonly muted?: boolean;
  readonly testID?: string;
}) {
  const colors = useColors();
  return (
    <Text style={[styles.body, { color: muted ? colors.ink2 : colors.ink }]} testID={testID}>
      {children}
    </Text>
  );
}

export function Card({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  const colors = useColors();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
      testID={testID}
    >
      {children}
    </View>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'link';

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  hint,
  testID,
  selected,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly testID?: string;
  readonly selected?: boolean;
}) {
  const colors = useColors();
  const off = disabled || busy;
  const fill =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.dangerSoft : colors.surfaceSolid;
  const ink =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'danger'
        ? colors.danger
        : variant === 'link'
          ? colors.primaryInk
          : colors.ink;
  const border = variant === 'secondary' || variant === 'danger' ? colors.lineStrong : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: off, busy, ...(selected !== undefined ? { selected } : {}) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'link' ? styles.linkButton : { backgroundColor: fill, borderColor: border },
        { opacity: off ? 0.5 : pressed ? 0.85 : 1 },
      ]}
      testID={testID}
    >
      {busy ? <ActivityIndicator color={ink} /> : null}
      <Text style={[styles.buttonText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  testID,
  ...input
}: TextInputProps & { readonly label: string; readonly error?: string | null }) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.ink3}
        {...input}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceSolid,
            color: colors.ink,
            borderColor: error ? colors.danger : focused ? colors.focus : colors.lineStrong,
          },
        ]}
        testID={testID}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.fieldError, { color: colors.danger }]}
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

/** A message the person must not miss: text first, colour second (never colour alone). */
export function Notice({
  tone = 'info',
  children,
  testID,
}: {
  readonly tone?: NoticeTone;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const colors = useColors();
  const fill = {
    info: colors.primarySoft,
    warning: colors.warningSoft,
    danger: colors.dangerSoft,
    success: colors.successSoft,
  }[tone];
  const ink = { info: colors.ink, warning: colors.warning, danger: colors.danger, success: colors.success }[
    tone
  ];
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: fill, borderColor: colors.line }]}
      testID={testID}
    >
      <Text style={[styles.noticeText, { color: ink }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', paddingVertical: space[6], paddingHorizontal: space[4] },
  column: { width: '100%', maxWidth: COLUMN_WIDTH, gap: space[4] },
  heading: {
    fontSize: type.section.size + 4,
    lineHeight: (type.section.size + 4) * type.section.lineHeight,
    fontWeight: '800',
    // `auto` follows the text's own direction: Arabic reads from the right.
    textAlign: 'auto',
  },
  body: {
    fontSize: type.prose.size + 1,
    lineHeight: (type.prose.size + 1) * type.prose.lineHeight,
    textAlign: 'auto',
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.card),
    padding: space[5],
    gap: space[3],
  },
  button: {
    minHeight: TOUCH_TARGET_PX + 4,
    borderRadius: px(radius.control),
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  linkButton: { minHeight: TOUCH_TARGET_PX, paddingVertical: space[2] },
  buttonText: { fontSize: 16, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  field: { gap: space[2] },
  fieldLabel: { fontSize: type.body.size + 1, fontWeight: '700', textAlign: 'auto' },
  input: {
    minHeight: TOUCH_TARGET_PX + 4,
    borderWidth: 1.5,
    borderRadius: px(radius.control),
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: 16,
    textAlign: 'auto',
  },
  fieldError: { fontSize: type.body.size + 1, fontWeight: '600', textAlign: 'auto' },
  notice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.control),
    padding: space[4],
  },
  noticeText: { fontSize: type.body.size + 1, lineHeight: (type.body.size + 1) * 1.5, textAlign: 'auto' },
});
