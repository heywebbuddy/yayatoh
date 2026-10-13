// Canary: colour literals in an app's .tsx must fail (tokens only, ADR 0025).
import { Text, View } from 'react-native';

export function Screen() {
  return (
    <View style={{ backgroundColor: '#6A3BFF', borderColor: 'rgba(0, 0, 0, 0.2)' }}>
      <Text style={{ color: 'white' }} />
    </View>
  );
}
