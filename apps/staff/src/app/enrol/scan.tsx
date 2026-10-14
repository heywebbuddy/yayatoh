import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { enrolmentFromLink } from '../../device';
import { minutesFrom } from '../../enrol/minutes';
import { useEnrol } from '../../enrol/use-enrol';
import { px, radius, space, useColors } from '../../theme';
import { Body, Button, Card, Heading, Notice, Screen } from '../../ui/kit';

/** The same QR code twice in a row is one scan: the camera sees a code many times a second. */
const REPEAT_MS = 2500;

/**
 * Scanning the enrolment QR (M7.4a). The camera is asked for only here, only for QR codes; when it
 * is denied the screen says how to allow it and offers the pasted link instead. The code is read in
 * memory: it is never logged, and anything that is not an enrolment link is ignored with a message.
 */
export default function EnrolScanScreen() {
  const t = useTranslations('enrol.scanner');
  const e = useTranslations('enrol');
  const core = useTranslations('core');
  const colors = useColors();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const { busy, error, retryAfterSeconds, enrol, clearError } = useEnrol();
  const [notQr, setNotQr] = useState(false);
  const last = useRef<{ data: string; at: number } | null>(null);
  const locked = useRef(false);

  const onScan = async ({ data }: { data: string }) => {
    const now = Date.now();
    if (locked.current || (last.current?.data === data && now - last.current.at < REPEAT_MS)) return;
    last.current = { data, at: now };
    const enrolment = enrolmentFromLink(data);
    if (!enrolment) {
      setNotQr(true);
      return;
    }
    setNotQr(false);
    locked.current = true;
    const ok = await enrol(enrolment);
    // On success the screen is leaving; after a refusal the person may scan again.
    if (!ok) locked.current = false;
  };

  if (!permission) {
    return (
      <Screen testID="scan-permission-loading">
        <Body muted>{t('checking')}</Body>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen testID="scan-permission-denied">
        <Heading>{t('permission.title')}</Heading>
        <Card>
          <Body>{t('permission.body')}</Body>
          {permission.canAskAgain ? (
            <Button
              label={t('permission.allow')}
              onPress={() => void requestPermission()}
              testID="scan-allow-camera"
            />
          ) : (
            <>
              <Body muted>{t('permission.settingsHint')}</Body>
              <Button
                label={t('permission.settings')}
                onPress={() => void Linking.openSettings()}
                testID="scan-open-settings"
              />
            </>
          )}
        </Card>
        <Button
          label={t('useLink')}
          onPress={() => router.back()}
          testID="scan-use-link"
          variant="secondary"
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} testID="enrol-scanner">
      <Heading>{t('title')}</Heading>
      <Body muted>{t('hint')}</Body>
      <View
        accessible
        accessibilityLabel={t('preview')}
        style={[styles.preview, { borderColor: colors.lineStrong, backgroundColor: colors.surface2 }]}
        testID="scan-preview"
      >
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => void onScan(result)}
          style={styles.camera}
        />
      </View>
      {busy ? (
        <Body muted testID="scan-working">
          {e('working')}
        </Body>
      ) : null}
      {notQr ? (
        <Notice tone="warning" testID="scan-not-enrolment">
          {t('invalid')}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="danger" testID="scan-error">
          {error === 'rateLimited'
            ? core('signIn.rateLimited', { minutes: minutesFrom(retryAfterSeconds) })
            : e(`errors.${error}`)}
        </Notice>
      ) : null}
      <Button
        label={t('useLink')}
        onPress={() => {
          clearError();
          router.back();
        }}
        testID="scan-use-link"
        variant="secondary"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 420,
    overflow: 'hidden',
    borderWidth: 2,
    borderRadius: px(radius.card),
    marginVertical: space[2],
  },
  camera: { flex: 1 },
});
