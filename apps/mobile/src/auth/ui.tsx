/**
 * The small set of controls the sign-in and account screens share (M7.3a): every one has a role and
 * a label, a 44 pt minimum touch target, tokens-only colours, logical (start/end) layout, and grows
 * with the system font size instead of clipping.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '../theme';

type Edge = 'top' | 'right' | 'bottom' | 'left';

/**
 * A scrolling screen on the canvas. `edges` are the sides the safe area pads: a screen under a
 * navigation header or above the tab bar leaves that side to it.
 */
export function Screen({
  children,
  testID,
  edges,
}: {
  children: ReactNode;
  testID?: string;
  edges?: readonly Edge[];
}) {
  const colors = useColors();
  return (
    <SafeAreaView edges={edges} style={[styles.screen, { backgroundColor: colors.canvas }]} testID={testID}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
      {children}
    </Text>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <Text accessibilityRole="header" style={[styles.subHeading, { color: colors.ink }]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = true,
  testID,
}: {
  children: ReactNode;
  muted?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Text style={[styles.body, { color: muted ? colors.ink2 : colors.ink }]} testID={testID}>
      {children}
    </Text>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly hint?: string;
  readonly testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  hint,
  testID,
}: ButtonProps) {
  const colors = useColors();
  const off = disabled || busy;
  const fill =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.surfaceSolid;
  const ink =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'danger'
        ? colors.onPrimary
        : variant === 'quiet'
          ? colors.primaryInk
          : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: variant === 'quiet' ? 'transparent' : fill,
          borderColor: variant === 'secondary' ? colors.lineStrong : 'transparent',
          opacity: off ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
      testID={testID}
    >
      {busy ? <ActivityIndicator color={ink} /> : null}
      <Text style={[styles.buttonText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  readonly label: string;
  readonly error?: string | null;
  readonly testID: string;
}

/** A labelled text field. The label is also the screen-reader label; the error is announced. */
export function Field({ label, error, testID, ...input }: FieldProps) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        placeholderTextColor={colors.ink3}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceSolid,
            borderColor: error ? colors.danger : colors.lineStrong,
            color: colors.ink,
          },
        ]}
        testID={testID}
        {...input}
      />
      {error ? <ErrorText testID={`${testID}-error`}>{error}</ErrorText> : null}
    </View>
  );
}

export function ErrorText({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useColors();
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.error, { color: colors.danger }]}
      testID={testID}
    >
      {children}
    </Text>
  );
}

/** A quiet confirmation ("we sent a new code"), announced politely. */
export function Notice({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useColors();
  return (
    <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: colors.success }]} testID={testID}>
      {children}
    </Text>
  );
}

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
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

export interface RowProps {
  readonly label: string;
  readonly value?: string | undefined;
  readonly onPress?: () => void;
  readonly role?: 'button' | 'radio';
  readonly checked?: boolean;
  readonly hint?: string;
  readonly testID?: string;
}

/** A settings row: a label with an optional value; a button or a radio when it can be pressed. */
export function Row({ label, value, onPress, role = 'button', checked, hint, testID }: RowProps) {
  const colors = useColors();
  const content = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.ink }]}>{label}</Text>
        {value ? <Text style={[styles.rowValue, { color: colors.ink2 }]}>{value}</Text> : null}
      </View>
      {/* The chosen row is also marked with a tick: a fill alone is not enough for everyone. */}
      {checked ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.rowMark, { color: colors.primaryInk }]}
        >
          ✓
        </Text>
      ) : null}
    </>
  );
  if (!onPress) {
    return (
      <View
        accessible
        accessibilityLabel={value ? `${label}, ${value}` : label}
        style={styles.row}
        testID={testID}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={value && role === 'button' ? `${label}, ${value}` : label}
      accessibilityHint={hint}
      accessibilityState={role === 'radio' ? { checked: Boolean(checked) } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: checked ? colors.primarySoft : pressed ? colors.surface3 : 'transparent' },
      ]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

export interface ToggleRowProps {
  readonly label: string;
  readonly body?: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly testID?: string;
}

/** A setting you switch on or off. The switch is small, so the row around it carries the 44 points. */
export function ToggleRow({ label, body, value, onValueChange, testID }: ToggleRowProps) {
  const colors = useColors();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.ink }]}>{label}</Text>
        {body ? <Text style={[styles.rowValue, { color: colors.ink2 }]}>{body}</Text> : null}
      </View>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={body}
        value={value}
        onValueChange={onValueChange}
        testID={testID}
      />
    </View>
  );
}

export function Stack({ children, gap = 4 }: { children: ReactNode; gap?: 2 | 3 | 4 | 6 }) {
  return <View style={{ gap: space[gap] }}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, padding: space[4], paddingBottom: space[8], gap: space[4] },
  heading: { fontSize: 28, lineHeight: 34, fontWeight: '800', textAlign: 'auto' },
  subHeading: {
    fontSize: type.card.size,
    lineHeight: type.card.size * type.card.lineHeight,
    fontWeight: '800',
    textAlign: 'auto',
  },
  body: { fontSize: type.prose.size, lineHeight: type.prose.size * type.prose.lineHeight, textAlign: 'auto' },
  button: {
    minHeight: TOUCH_TARGET_PX,
    borderRadius: px(radius.control),
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  field: { gap: space[2] },
  label: { fontSize: type.body.size, fontWeight: '700', textAlign: 'auto' },
  input: {
    minHeight: TOUCH_TARGET_PX,
    borderRadius: px(radius.control),
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: 17,
    textAlign: 'auto',
  },
  error: { fontSize: type.body.size, lineHeight: type.body.size * type.body.lineHeight, textAlign: 'auto' },
  notice: { fontSize: type.body.size, lineHeight: type.body.size * type.body.lineHeight, textAlign: 'auto' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.card),
    padding: space[4],
    gap: space[3],
  },
  row: {
    minHeight: TOUCH_TARGET_PX,
    borderRadius: px(radius.control),
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    gap: space[2],
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleRow: { minHeight: TOUCH_TARGET_PX, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rowText: { flex: 1, gap: space[1] },
  rowMark: { fontSize: 18, fontWeight: '800' },
  rowLabel: { fontSize: 16, fontWeight: '600', textAlign: 'auto' },
  rowValue: { fontSize: type.body.size, textAlign: 'auto' },
});
