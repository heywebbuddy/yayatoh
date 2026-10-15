import { ActivityIndicator, View } from 'react-native';
import { useScanRuntime } from '../../scan/provider';
import { ScanView } from '../../scan/ui/scan-screen';
import { useColors } from '../../theme';

/** The door scanner (M7.4b). Waits for the device's runtime, then shows the scan screen. */
export default function ScanRoute() {
  const runtime = useScanRuntime();
  const colors = useColors();
  if (!runtime) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas }}
      >
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  return <ScanView engine={runtime.engine} scheduler={runtime.scheduler} />;
}
