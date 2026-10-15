import { Pressable, Text } from 'react-native';

/** Stands in for Apple's native button (a native view that does not exist under Jest). */
export function AppleButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: 48 }}
      testID="apple-button"
    >
      <Text>{label}</Text>
    </Pressable>
  );
}
