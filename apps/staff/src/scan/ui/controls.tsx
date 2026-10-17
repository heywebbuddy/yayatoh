/** Buttons for the scan screens: tokens only, 44 pt minimum target, a role and a label on each. */
import { Pressable, StyleSheet, Text } from 'react-native';
import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '../../theme';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: 'primary' | 'secondary';
  readonly disabled?: boolean;
  /** For toggles (the torch, the direction switch). */
  readonly selected?: boolean;
  /** `radio` for one choice out of a group (the direction switch); the state is then `checked`. */
  readonly role?: 'button' | 'radio';
  readonly testID?: string;
  readonly accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  selected,
  role = 'button',
  testID,
  accessibilityHint,
}: ButtonProps) {
  const colors = useColors();
  const primary = variant === 'primary' || selected === true;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{
        disabled,
        ...(selected === undefined ? {} : role === 'radio' ? { checked: selected } : { selected }),
      }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? colors.primary : colors.surfaceSolid,
          borderColor: primary ? colors.primary : colors.line,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={[styles.label, { color: primary ? colors.onPrimary : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TOUCH_TARGET_PX,
    minWidth: TOUCH_TARGET_PX,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: px(radius.control),
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: type.body.size + 2, fontWeight: '700', textAlign: 'center' },
});
