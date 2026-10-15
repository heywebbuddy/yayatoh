import { useTheme } from '@yayatoh/mobile-core';
import * as AppleAuthentication from 'expo-apple-authentication';
import { StyleSheet } from 'react-native';

/**
 * Apple's own button (its label is translated by iOS and follows Apple's design rules). It is a
 * native view, so this is the one place that imports it and tests replace it.
 */
export function AppleButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { scheme } = useTheme();
  return (
    <AppleAuthentication.AppleAuthenticationButton
      accessibilityLabel={label}
      buttonStyle={
        scheme === 'dark'
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      }
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      cornerRadius={14}
      onPress={onPress}
      style={styles.button}
    />
  );
}

const styles = StyleSheet.create({ button: { minHeight: 48, width: '100%' } });
