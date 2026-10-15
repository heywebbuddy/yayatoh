import * as Battery from 'expo-battery';

/** The battery level as a percentage, or null where the phone cannot say (a simulator, some tablets). */
export async function batteryPercent(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 && level <= 1 ? Math.round(level * 100) : null;
  } catch {
    return null;
  }
}
