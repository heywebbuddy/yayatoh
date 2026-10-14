/**
 * Small controls for the Tickets screens (M7.3b): built from the design tokens only, 44 pt touch
 * targets, a role and a label on everything interactive, logical (start/end) spacing, and a status
 * that is always text as well as colour.
 */
import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '@yayatoh/mobile-core';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  type AccessibilityRole,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({
  children,
  refreshing,
  onRefresh,
  refreshLabel,
  testID,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  refreshLabel?: string;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.canvas }]} testID={testID}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              accessibilityLabel={refreshLabel}
              tintColor={colors.primary}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
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
  tone = 'ink',
  testID,
}: {
  children: ReactNode;
  tone?: 'ink' | 'ink2';
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Text style={[styles.body, { color: colors[tone] }]} testID={testID}>
      {children}
    </Text>
  );
}

export function Caption({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.caption, { color: colors.ink2 }]} testID={testID}>
      {children}
    </Text>
  );
}

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
    >
      {children}
    </View>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  hint,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
  testID?: string;
}) {
  const colors = useColors();
  const inactive = Boolean(disabled || busy);
  const fill =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.dangerSoft : colors.surface2;
  const ink = variant === 'primary' ? colors.onPrimary : variant === 'danger' ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: fill,
          borderColor: variant === 'secondary' ? colors.lineStrong : fill,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? <ActivityIndicator color={ink} /> : null}
      <Text style={[styles.buttonLabel, { color: ink }]} maxFontSizeMultiplier={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string | null }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.ink }]} accessibilityRole="text">
        {label}
      </Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        placeholderTextColor={colors.ink3}
        style={[
          styles.input,
          {
            color: colors.ink,
            backgroundColor: colors.surfaceSolid,
            borderColor: error ? colors.danger : colors.lineStrong,
            // Text typed in the app's language follows its own direction.
            textAlign: 'auto',
          },
        ]}
      />
      {error ? (
        <Text style={[styles.error, { color: colors.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export type Tone = 'info' | 'success' | 'warning' | 'danger';

/** A notice. The tone changes the colour; the title and text carry the meaning. */
export function Banner({
  tone = 'info',
  title,
  children,
  testID,
  role = 'alert',
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  testID?: string;
  role?: AccessibilityRole;
}) {
  const colors = useColors();
  const soft = {
    info: colors.primarySoft,
    success: colors.successSoft,
    warning: colors.warningSoft,
    danger: colors.dangerSoft,
  }[tone];
  const ink = { info: colors.primaryInk, success: colors.success, warning: colors.warning, danger: colors.danger }[
    tone
  ];
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole={role}
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: soft, borderColor: ink }]}
    >
      {title ? <Text style={[styles.bannerTitle, { color: ink }]}>{title}</Text> : null}
      {typeof children === 'string' ? <Text style={[styles.body, { color: colors.ink }]}>{children}</Text> : children}
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={styles.center}
      testID="loading"
    >
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.body, { color: colors.ink2 }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
  testID,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.center} testID={testID}>
      <Heading level={2}>{title}</Heading>
      {body ? <Body tone="ink2">{body}</Body> : null}
      {action}
    </View>
  );
}

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surface3 }]} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            testID={`segment-${o.value}`}
            style={[styles.segment, { backgroundColor: selected ? colors.surfaceSolid : 'transparent' }]}
          >
            <Text style={[styles.buttonLabel, { color: selected ? colors.primaryInk : colors.ink2 }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled line of facts: the label is muted, the value is read after it as one phrase. */
export function Fact({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const colors = useColors();
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text style={[styles.caption, { color: colors.ink2 }]}>{label}</Text>
      <Text style={[styles.factValue, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

/** A back link at the top of a pushed screen. */
export function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onBack}
      testID="back"
      style={styles.back}
    >
      <Text style={[styles.buttonLabel, { color: colors.primaryInk }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: space[4], gap: space[4], paddingBottom: space[10] },
  h1: { fontSize: 28, fontWeight: '800', textAlign: 'auto' },
  h2: { fontSize: type.card.size, fontWeight: '800', textAlign: 'auto' },
  body: { fontSize: type.prose.size, lineHeight: type.prose.size * 1.5, textAlign: 'auto' },
  caption: { fontSize: type.caption.size, lineHeight: type.caption.size * type.caption.lineHeight, textAlign: 'auto' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.card),
    padding: space[4],
    gap: space[3],
  },
  button: {
    minHeight: TOUCH_TARGET_PX,
    borderRadius: px(radius.control),
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  buttonLabel: { fontSize: type.prose.size, fontWeight: '700', textAlign: 'center' },
  field: { gap: space[1] },
  fieldLabel: { fontSize: type.body.size, fontWeight: '700', textAlign: 'auto' },
  input: {
    minHeight: TOUCH_TARGET_PX,
    borderWidth: 1,
    borderRadius: px(radius.control),
    paddingHorizontal: space[3],
    fontSize: type.prose.size,
  },
  error: { fontSize: type.body.size, textAlign: 'auto' },
  banner: {
    borderWidth: 1,
    borderRadius: px(radius.tile),
    padding: space[3],
    gap: space[1],
  },
  bannerTitle: { fontSize: type.body.size, fontWeight: '800', textAlign: 'auto' },
  center: { alignItems: 'center', justifyContent: 'center', gap: space[3], padding: space[6] },
  segmented: { flexDirection: 'row', borderRadius: px(radius.pill), padding: space[1] },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET_PX,
    borderRadius: px(radius.pill),
    alignItems: 'center',
    justifyContent: 'center',
  },
  fact: { gap: 2 },
  factValue: { fontSize: type.prose.size, fontWeight: '600', textAlign: 'auto' },
  back: { minHeight: TOUCH_TARGET_PX, justifyContent: 'center', alignSelf: 'flex-start' },
});
