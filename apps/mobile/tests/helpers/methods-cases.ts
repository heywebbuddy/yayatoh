import { availableMethods } from '../../src/auth/methods';

/** Which sign-in buttons a phone offers, by platform and build configuration. */
export function AvailableMethodsCases() {
  describe('availableMethods', () => {
    it('Apple on iOS only', () => {
      expect(availableMethods('ios', {}).apple).toBe(true);
      expect(availableMethods('android', {}).apple).toBe(false);
    });

    it('Google when the build has a client id for this platform', () => {
      expect(availableMethods('ios', { googleIosClientId: 'x.apps.googleusercontent.com' }).google).toBe(
        true,
      );
      expect(availableMethods('ios', { googleAndroidClientId: 'x' }).google).toBe(false);
      expect(availableMethods('android', { googleAndroidClientId: 'x' }).google).toBe(true);
      expect(availableMethods('android', {}).google).toBe(false);
    });
  });
}
