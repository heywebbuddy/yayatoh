/** Typing a ticket code by hand (M7.4b): the way in when a QR is torn, dim or the camera is off. */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '../../theme';
import { Button } from './controls';

export interface ManualEntryProps {
  readonly onSubmit: (code: string) => void | Promise<void>;
  readonly onClose: () => void;
}

export function ManualEntry({ onSubmit, onClose }: ManualEntryProps) {
  const t = useTranslations('scan.manual');
  const colors = useColors();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const submit = () => {
    const code = value.trim();
    if (!code) {
      setError(true);
      return;
    }
    setError(false);
    setValue('');
    void onSubmit(code);
  };

  return (
    <View
      style={[styles.box, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
      testID="manual-entry"
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('title')}
      </Text>
      <TextInput
        accessibilityLabel={t('label')}
        accessibilityHint={t('hint')}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        // Never offer the code to the keyboard's learning (personal data).
        importantForAutofill="no"
        textContentType="none"
        value={value}
        onChangeText={(v) => {
          setValue(v);
          if (error) setError(false);
        }}
        onSubmitEditing={submit}
        returnKeyType="done"
        placeholder={t('placeholder')}
        placeholderTextColor={colors.ink3}
        style={[
          styles.input,
          {
            color: colors.ink,
            borderColor: error ? colors.danger : colors.line,
            backgroundColor: colors.canvas,
          },
        ]}
        testID="manual-input"
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.danger }]}
          testID="manual-error"
        >
          {t('empty')}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button variant="primary" label={t('submit')} onPress={submit} testID="manual-submit" />
        <Button label={t('close')} onPress={onClose} testID="manual-close" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: px(radius.card),
    borderWidth: StyleSheet.hairlineWidth,
    padding: space[5],
    gap: space[3],
  },
  title: { fontSize: type.card.size, fontWeight: '800', textAlign: 'auto' },
  input: {
    minHeight: TOUCH_TARGET_PX + 8,
    borderWidth: 1,
    borderRadius: px(radius.control),
    paddingHorizontal: space[4],
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'auto',
  },
  error: { fontSize: type.body.size + 2, fontWeight: '600', textAlign: 'auto' },
  actions: { gap: space[2] },
});
