import config from '../../app.config';

describe('the Staff build for scanning', () => {
  const built = config() as {
    plugins?: unknown[];
    android?: { permissions?: string[] };
    ios?: { infoPlist?: Record<string, unknown> };
  };

  it('builds expo-sqlite with SQLCipher, so the guest list is encrypted on disk', () => {
    expect(built.plugins).toContainEqual(['expo-sqlite', { useSQLCipher: true }]);
  });

  it('asks for the camera and explains why, in the phone’s language', () => {
    expect(built.android?.permissions).toContain('android.permission.CAMERA');
    expect(built.ios?.infoPlist?.NSCameraUsageDescription).toMatch(/camera .* scan ticket QR codes/);
  });

  it('asks for nothing else: no microphone, no location, no photos', () => {
    expect(built.android?.permissions).toEqual(['android.permission.CAMERA']);
    const keys = Object.keys(built.ios?.infoPlist ?? {}).filter(
      (k) => k.startsWith('NS') && k.endsWith('UsageDescription'),
    );
    expect(keys).toEqual(['NSCameraUsageDescription']);
  });
});
