/**
 * The camera preview that reads QR codes and nothing else (M7.4b): `react-native-vision-camera`
 * v5 with an object output restricted to `qr`, so no barcode of another kind can ever become a scan.
 * The only file that imports the camera.
 */

import { constant } from '@yayatoh/ui/tokens';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  isScannedCode,
  type ScannedObject,
  type ScannedObjectType,
  useCameraDevice,
  useCameraPermission,
  useObjectOutput,
} from 'react-native-vision-camera';
import { useTranslations } from 'use-intl';
import { px, radius, space, useColors } from '../../theme';
import { CameraGate, type CameraPermission } from './camera-gate';
import { Button } from './controls';

/** Module-level so the output is made once (the hook re-creates it when this array changes). */
const QR_ONLY: ScannedObjectType[] = ['qr'];

export interface QrCameraProps {
  /** False while a manual entry or another screen covers the camera: it stops using power. */
  readonly active: boolean;
  readonly torch: boolean;
  readonly height: number;
  readonly onCode: (code: string) => void;
  /** Reports whether this phone has a torch, so the control only shows when it works. */
  readonly onTorchSupport: (supported: boolean) => void;
  readonly onTypeCode: () => void;
}

const permissionOf = (status: string): CameraPermission =>
  status === 'authorized' ? 'granted' : status === 'not-determined' ? 'ask' : 'denied';

export function QrCamera({ active, torch, height, onCode, onTorchSupport, onTypeCode }: QrCameraProps) {
  const permission = useCameraPermission();
  const state = permissionOf(permission.status);
  if (state !== 'granted') {
    return (
      <CameraGate
        permission={state}
        onAllow={() => void permission.requestPermission()}
        onTypeCode={onTypeCode}
      />
    );
  }
  return (
    <Preview
      active={active}
      torch={torch}
      height={height}
      onCode={onCode}
      onTorchSupport={onTorchSupport}
      onTypeCode={onTypeCode}
    />
  );
}

function Preview({ active, torch, height, onCode, onTorchSupport, onTypeCode }: QrCameraProps) {
  const t = useTranslations('scan.camera');
  const colors = useColors();
  const device = useCameraDevice('back');
  const latest = useRef(onCode);
  latest.current = onCode;

  const onObjectsScanned = useCallback((objects: ScannedObject[]) => {
    for (const o of objects) {
      if (isScannedCode(o) && typeof o.value === 'string' && o.value.length > 0) {
        latest.current(o.value);
        return;
      }
    }
  }, []);
  const objectOutput = useObjectOutput({ types: QR_ONLY, onObjectsScanned });

  useEffect(() => {
    onTorchSupport(device?.hasTorch === true);
  }, [device, onTorchSupport]);

  if (!device) {
    return (
      <View
        style={[
          styles.empty,
          { minHeight: height, backgroundColor: colors.surfaceSolid, borderColor: colors.line },
        ]}
        testID="camera-unavailable"
      >
        <Text style={[styles.emptyText, { color: colors.ink2 }]}>{t('unavailable')}</Text>
        <Button label={t('typeCode')} onPress={onTypeCode} testID="camera-unavailable-type-code" />
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={t('preview')}
      style={[styles.frame, { height, borderColor: colors.line }]}
      testID="camera-preview"
    >
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={active}
        outputs={[objectOutput]}
        torchMode={torch && device.hasTorch ? 'on' : 'off'}
      />
      {/* A square to aim with; the colour is decoration, the words say what to do. */}
      <View pointerEvents="none" style={[styles.reticle, { borderColor: colors.onPrimary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: px(radius.card),
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: constant.black,
  },
  reticle: { width: '62%', aspectRatio: 1, borderWidth: 3, borderRadius: px(radius.tile) },
  empty: {
    borderRadius: px(radius.card),
    borderWidth: StyleSheet.hairlineWidth,
    padding: space[5],
    justifyContent: 'center',
    gap: space[3],
  },
  emptyText: { fontSize: 17, textAlign: 'auto' },
});
