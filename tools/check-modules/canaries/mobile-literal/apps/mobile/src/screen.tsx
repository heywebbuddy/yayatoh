// Canary: literal UI strings in an app's .tsx must fail (catalogs only, ADR 0025).
import { Pressable, Text, View } from 'react-native';

export function Screen() {
  return (
    <View>
      <Text>Welcome back</Text>
      <Pressable accessibilityLabel="Open my tickets" />
    </View>
  );
}
