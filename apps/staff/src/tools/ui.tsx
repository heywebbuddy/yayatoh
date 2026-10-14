/**
 * The small set of building blocks the door-tool screens share (M7.4c): tokens only, light and
 * dark, 44 pt touch targets, logical (start/end) spacing so Arabic mirrors, and wrapping layouts
 * that survive the largest system font. State is never colour alone: notices carry a glyph and text.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '../theme';

/** An iPad (or a phone on its side) gets two columns and a capped reading width. */
export const WIDE_BREAKPOINT = 768;
export const MAX_CONTENT_WIDTH = 1040;

export function useWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}

export function Screen({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useColors();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]} edges={['bottom', 'left', 'right']}>
      <ScrollView
        testID={testID}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.column}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Children side by side on a wide screen, stacked on a phone. */
export function Columns({ children, testID }: { children: ReactNode; testID?: string }) {
  const wide = useWide();
  return (
    <View testID={testID} style={[styles.columns, wide && styles.columnsWide]}>
      {children}
    </View>
  );
}

export function Pane({ children }: { children: ReactNode }) {
  const wide = useWide();
  return <View style={[styles.pane, wide && styles.paneWide]}>{children}</View>;
}

export function Heading({ children, level = 1 }: { children: ReactNode; level?: 1 | 2 }) {
  const colors = useColors();
  return (
    <Text
      accessibilityRole="header"
      style={[level === 1 ? styles.h1 : styles.h2, { color: colors.ink }]}
      maxFontSizeMultiplier={2}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  testID,
}: {
  children: ReactNode;
  muted?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Text testID={testID} style={[styles.body, { color: muted ? colors.ink2 : colors.ink }]}>
      {children}
    </Text>
  );
}

export function Card({
  children,
  testID,
  accessibilityLabel,
}: {
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      accessible={accessibilityLabel ? true : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
    >
      {children}
    </View>
  );
}

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  testID,
  hint,
  a11yLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  hint?: string;
  /** Spoken name when the visible label alone is ambiguous in a list ("Check in Ada Lovelace"). */
  a11yLabel?: string;
}) {
  const colors = useColors();
  const off = disabled || busy;
  const bg =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.dangerSoft : colors.surface3;
  const fg = variant === 'primary' ? colors.onPrimary : variant === 'danger' ? colors.danger : colors.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'secondary' ? colors.lineStrong : bg },
        pressed && { opacity: 0.85 },
        off && { opacity: 0.55 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={[styles.buttonLabel, { color: fg }]} maxFontSizeMultiplier={2}>
        {label}
      </Text>
    </Pressable>
  );
}

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
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
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
  hint,
  ...input
}: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.ink3}
        style={[
          styles.input,
          {
            color: colors.ink,
            backgroundColor: colors.surface2,
            borderColor: error ? colors.danger : colors.lineStrong,
          },
        ]}
        {...input}
      />
      {hint && !error ? <Text style={[styles.caption, { color: colors.ink2 }]}>{hint}</Text> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: colors.danger }]}>
          ! {error}
        </Text>
      ) : null}
    </View>
  );
}

export type Tone = 'ok' | 'warn' | 'stop' | 'info';
const GLYPH: Record<Tone, string> = { ok: '✓', warn: '!', stop: '✕', info: 'i' };

/** A message with a glyph and text, so the tone never rests on colour alone. */
export function Notice({
  tone,
  children,
  testID,
}: {
  tone: Tone;
  children: ReactNode;
  testID?: string;
}) {
  const colors = useColors();
  const bg =
    tone === 'ok'
      ? colors.successSoft
      : tone === 'warn'
        ? colors.warningSoft
        : tone === 'stop'
          ? colors.dangerSoft
          : colors.primarySoft;
  const fg =
    tone === 'ok'
      ? colors.success
      : tone === 'warn'
        ? colors.warning
        : tone === 'stop'
          ? colors.danger
          : colors.primaryInk;
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: bg, borderColor: fg }]}
    >
      <Text style={[styles.glyph, { color: fg }]} accessibilityElementsHidden importantForAccessibility="no">
        {GLYPH[tone]}
      </Text>
      <Text style={[styles.noticeText, { color: colors.ink }]}>{children}</Text>
    </View>
  );
}

export function Stat({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const colors = useColors();
  return (
    <View testID={testID} accessible accessibilityLabel={`${label}: ${value}`} style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.ink }]} maxFontSizeMultiplier={1.6}>
        {value}
      </Text>
      <Text style={[styles.caption, { color: colors.ink2 }]}>{label}</Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.state} testID="loading">
      <ActivityIndicator color={colors.primaryInk} />
      <Text style={[styles.body, { color: colors.ink2 }]}>{label}</Text>
    </View>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.state} testID="empty">
      <Heading level={2}>{title}</Heading>
      {body ? <Body muted>{body}</Body> : null}
    </View>
  );
}

export function ErrorState({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.state} testID="error">
      <Notice tone="stop">{message}</Notice>
      <Button label={retryLabel} onPress={onRetry} variant="secondary" testID="retry" />
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function Gap({ size = 3 }: { size?: number }) {
  return <View style={{ height: space[size] }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space[4], alignItems: 'center' },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, gap: space[3] },
  columns: { gap: space[3] },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  pane: { gap: space[3] },
  paneWide: { flex: 1 },
  h1: { fontSize: type.section.size, fontWeight: '800', textAlign: 'auto' },
  h2: { fontSize: type.card.size, fontWeight: '800', textAlign: 'auto' },
  body: { fontSize: type.prose.size, lineHeight: type.prose.size * 1.5, textAlign: 'auto' },
  caption: { fontSize: type.caption.size + 1, lineHeight: (type.caption.size + 1) * 1.45, textAlign: 'auto' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.tile),
    padding: space[4],
    gap: space[2],
  },
  button: {
    minHeight: TOUCH_TARGET_PX,
    minWidth: TOUCH_TARGET_PX,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: px(radius.control),
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  buttonLabel: { fontSize: type.prose.size, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  chip: {
    minHeight: TOUCH_TARGET_PX,
    paddingHorizontal: space[3],
    borderRadius: px(radius.pill),
    borderWidth: 1,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: type.body.size + 1, fontWeight: '600' },
  field: { gap: space[1] },
  fieldLabel: { fontSize: type.body.size + 1, fontWeight: '700', textAlign: 'auto' },
  input: {
    minHeight: TOUCH_TARGET_PX,
    borderWidth: 1,
    borderRadius: px(radius.control),
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontSize: type.prose.size,
  },
  notice: {
    flexDirection: 'row',
    gap: space[2],
    padding: space[3],
    borderRadius: px(radius.control),
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  glyph: { fontSize: 18, fontWeight: '900', minWidth: 20, textAlign: 'center' },
  noticeText: { flex: 1, fontSize: type.prose.size, lineHeight: type.prose.size * 1.45, textAlign: 'auto' },
  stat: { gap: 2, minWidth: 96, flexShrink: 1 },
  statValue: { fontSize: type.stat.size * 0.8, fontWeight: '800' },
  state: { gap: space[3], paddingVertical: space[6], alignItems: 'stretch' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' },
});
