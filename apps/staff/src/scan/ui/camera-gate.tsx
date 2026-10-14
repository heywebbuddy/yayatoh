/**
 * What the camera area shows before there is a camera (M7.4b): ask for permission, or, when it was
 * refused, how to turn it back on. A refusal never traps the door: typing a ticket code still works.
 */
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { px, radius, space, type, useColors } from '../../theme';
import { Button } from './controls';

export type CameraPermission = 'granted' | 'ask' | 'denied';

export interface CameraGateProps {
  readonly permission: CameraPermission;
  readonly onAllow: () => void;
  /** Opens the system settings page of this app. Defaults to `Linking.openSettings`. */
  readonly onOpenSettings?: () => void;
  readonly onTypeCode: () => void;
}

export function CameraGate({ permission, onAllow, onOpenSettings, onTypeCode }: CameraGateProps) {
  const t = useTranslations('scan.camera');
  const colors = useColors();
  const denied = permission === 'denied';
  return (
    <View
      style={[styles.box, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
      testID={denied ? 'camera-denied' : 'camera-ask'}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {denied ? t('deniedTitle') : t('askTitle')}
      </Text>
      <Text style={[styles.body, { color: colors.ink2 }]}>{denied ? t('deniedBody') : t('askBody')}</Text>
      <View style={styles.actions}>
        {denied ? (
          <Button
            variant="primary"
            label={t('openSettings')}
            onPress={onOpenSettings ?? (() => void Linking.openSettings())}
            testID="camera-open-settings"
          />
        ) : (
          <Button variant="primary" label={t('allow')} onPress={onAllow} testID="camera-allow" />
        )}
        <Button label={t('typeCode')} onPress={onTypeCode} testID="camera-type-code" />
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
  body: { fontSize: type.prose.size + 1, lineHeight: (type.prose.size + 1) * 1.5, textAlign: 'auto' },
  actions: { gap: space[2], marginTop: space[2] },
});
