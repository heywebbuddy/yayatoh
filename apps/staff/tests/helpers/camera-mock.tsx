/** A stand-in for `expo-camera`: the permission is controllable and a test can "scan" a code. */
import { View } from 'react-native';

export const camera = {
  permission: null as null | { granted: boolean; canAskAgain: boolean },
  request: jest.fn(async () => {}),
  onBarcodeScanned: null as null | ((event: { data: string }) => void),
  props: null as null | Record<string, unknown>,
};

export const resetCamera = () => {
  camera.permission = { granted: true, canAskAgain: true };
  camera.request.mockClear();
  camera.onBarcodeScanned = null;
  camera.props = null;
};

export const useCameraPermissions = () => [camera.permission, camera.request];

export function CameraView(props: { onBarcodeScanned?: (event: { data: string }) => void }) {
  camera.onBarcodeScanned = props.onBarcodeScanned ?? null;
  camera.props = props as Record<string, unknown>;
  return <View testID="camera-view" />;
}
