import { act } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { redirectSystemPath } from '../src/app/+native-intent';
import { DeviceGuard, EnrolmentLinks } from '../src/device';
import { EVENT_ID, enrolLink, TOKEN } from './helpers/fake-door';
import { buildApp, renderApp, settle, slowStorage } from './helpers/render';
import { resetRouter, router, state } from './helpers/router-mock';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-linking', () => {
  const listeners = new Set();
  return {
    __listeners: listeners,
    getInitialURL: jest.fn(async () => null),
    addEventListener: jest.fn((_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    }),
  };
});

const links = Linking as unknown as {
  __listeners: Set<(event: { url: string }) => void>;
  getInitialURL: jest.Mock;
};
const open = async (url: string) => {
  await act(async () => {
    for (const l of links.__listeners) l({ url });
  });
};

beforeEach(() => {
  resetRouter();
  links.getInitialURL.mockResolvedValue(null);
  links.__listeners.clear();
});

describe('enrolment links that open the app', () => {
  it('opens the enrolment screen with the event and key from a link opened while running', async () => {
    await renderApp(<EnrolmentLinks />);
    await open(enrolLink());
    expect(router.navigate).toHaveBeenCalledWith({
      pathname: '/enrol',
      params: { event: EVENT_ID, key: TOKEN },
    });
  });

  it('opens it for the link that launched the app', async () => {
    links.getInitialURL.mockResolvedValue(enrolLink());
    await renderApp(<EnrolmentLinks />);
    await settle();
    expect(router.navigate).toHaveBeenCalledWith({
      pathname: '/enrol',
      params: { event: EVENT_ID, key: TOKEN },
    });
  });

  it('says so when it looks like an enrolment link but is not one, without passing it on', async () => {
    await renderApp(<EnrolmentLinks />);
    await open(`https://app.yayatoh.com/scan#e=${EVENT_ID}&k=yyd_short`);
    expect(router.navigate).toHaveBeenCalledWith({ pathname: '/enrol', params: { invalid: '1' } });
    expect(JSON.stringify(router.navigate.mock.calls)).not.toContain('yyd_short');
  });

  it('ignores every other link', async () => {
    await renderApp(<EnrolmentLinks />);
    await open('https://app.yayatoh.com/tickets/abc');
    await open('yayatoh-staff://settings');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('stops listening when it unmounts', async () => {
    const { unmount } = await renderApp(<EnrolmentLinks />);
    expect(links.__listeners.size).toBe(1);
    unmount();
    expect(links.__listeners.size).toBe(0);
  });

  it('keeps the key out of the system path the router sees', () => {
    expect(redirectSystemPath({ path: `/scan#e=${EVENT_ID}&k=${TOKEN}`, initial: true })).toBe('/');
    expect(redirectSystemPath({ path: enrolLink(), initial: false })).toBe('/');
    expect(redirectSystemPath({ path: '/scan', initial: false })).toBe('/');
    expect(redirectSystemPath({ path: '/tools/leads', initial: false })).toBe('/tools/leads');
  });
});

describe('the device guard', () => {
  async function enrolled() {
    const app = buildApp();
    await app.device.enrol(enrolLink());
    await app.device.heartbeat();
    app.device.stopHeartbeat();
    return app;
  }

  it('leaves an enrolled device where it is', async () => {
    state.pathname = '/scan';
    await renderApp(<DeviceGuard />, await enrolled());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each(['/scan', '/select', '/scan/history'])(
    'sends a device that is not enrolled away from %s',
    async (path) => {
      state.pathname = path;
      await renderApp(<DeviceGuard />);
      expect(router.replace).toHaveBeenCalledWith('/enrol');
    },
  );

  it.each(['/enrol', '/sign-in/organizer', '/tools', '/'])(
    'does not touch %s for a device that is not enrolled',
    async (path) => {
      state.pathname = path;
      await renderApp(<DeviceGuard />);
      expect(router.replace).not.toHaveBeenCalled();
    },
  );

  it('returns a wiped device from the scanner to enrolment as soon as its heartbeat says so', async () => {
    const app = await enrolled();
    state.pathname = '/scan';
    await renderApp(<DeviceGuard />, app);
    expect(router.replace).not.toHaveBeenCalled();
    app.door.wiping.add(TOKEN);
    await act(async () => {
      await app.device.heartbeat();
    });
    await settle();
    expect(app.device.state.status).toBe('wiped');
    expect(router.replace).toHaveBeenCalledWith('/enrol');
  });

  it('returns a revoked device from the picker to enrolment', async () => {
    const app = await enrolled();
    state.pathname = '/select';
    await renderApp(<DeviceGuard />, app);
    app.door.valid.delete(TOKEN);
    await act(async () => {
      await app.device.heartbeat();
    });
    await settle();
    expect(app.device.state.status).toBe('revoked');
    expect(router.replace).toHaveBeenCalledWith('/enrol');
  });

  it('waits until the stored enrolment has been read', async () => {
    state.pathname = '/scan';
    const app = await enrolled();
    const keychain = slowStorage(Object.fromEntries(app.storage.data));
    const again = buildApp({ storage: keychain.store });
    await renderApp(<DeviceGuard />, again, { settle: false });
    expect(router.replace).not.toHaveBeenCalled();
    await keychain.release();
    await settle();
    // Once read, the enrolled device stays where it is.
    expect(router.replace).not.toHaveBeenCalled();
  });
});
