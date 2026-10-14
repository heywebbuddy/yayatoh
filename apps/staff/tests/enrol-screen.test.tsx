import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { memoryKeyValueStore } from '@yayatoh/mobile-core';
import EnrolScreen from '../src/app/enrol/index';
import { DEVICE_KEY, ENDED_KEY } from '../src/device/session';
import { catalogs } from '../src/i18n';
import { EVENT_ID, enrolLink, OTHER_TOKEN, TOKEN } from './helpers/fake-door';
import { buildApp, missingMessages, renderApp, settle, shownTexts } from './helpers/render';
import { resetRouter, router, state } from './helpers/router-mock';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const en = catalogs.en;
beforeEach(resetRouter);

async function paste(link: string) {
  fireEvent.changeText(screen.getByTestId('enrol-link'), link);
  fireEvent.press(screen.getByTestId('enrol-submit'));
  await settle();
  await settle();
}

describe('the enrolment screen', () => {
  it('asks to scan the QR code or paste the link, and says what the device needs', async () => {
    await renderApp(<EnrolScreen />);
    expect(screen.getByRole('header', { name: en.enrol.title })).toBeOnTheScreen();
    expect(screen.getByText(en.enrol.intro)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en.enrol.scan })).toBeOnTheScreen();
    expect(screen.getByLabelText(en.enrol.linkLabel)).toBeOnTheScreen();
    expect(missingMessages(shownTexts())).toEqual([]);
  });

  it('opens the camera screen', async () => {
    await renderApp(<EnrolScreen />);
    fireEvent.press(screen.getByTestId('enrol-scan'));
    expect(router.push).toHaveBeenCalledWith('/enrol/scan');
  });

  it('enrols with a pasted link, keeps the key in the keychain, and leaves for the gate', async () => {
    const { app } = await renderApp(<EnrolScreen />);
    await paste(enrolLink());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(app.device.state).toMatchObject({ status: 'enrolled', eventId: EVENT_ID, token: TOKEN });
    expect(app.storage.data.get(DEVICE_KEY)).toContain(TOKEN);
    for (const call of app.door.calls) expect(call.url).not.toContain(TOKEN);
  });

  it('refuses text that is not an enrolment link, with its message and no request', async () => {
    const { app } = await renderApp(<EnrolScreen />);
    await paste('https://example.org/hello');
    expect(screen.getByTestId('enrol-error')).toHaveTextContent(en.enrol.errors.invalid_link);
    expect(app.door.calls).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('refuses an empty field the same way', async () => {
    await renderApp(<EnrolScreen />);
    await paste('');
    expect(screen.getByTestId('enrol-error')).toHaveTextContent(en.enrol.errors.invalid_link);
  });

  it('says when the server no longer accepts the code', async () => {
    await renderApp(<EnrolScreen />);
    await paste(enrolLink(OTHER_TOKEN));
    expect(screen.getByTestId('enrol-error')).toHaveTextContent(en.enrol.errors.rejected);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says when the code is for another event', async () => {
    const app = buildApp();
    app.door.overviewStatus = 404;
    await renderApp(<EnrolScreen />, app);
    await paste(enrolLink());
    expect(screen.getByTestId('enrol-error')).toHaveTextContent(en.enrol.errors.wrong_event);
  });

  it('says when there is no connection, and clears the message when the person types again', async () => {
    const app = buildApp();
    app.door.failNetwork = true;
    await renderApp(<EnrolScreen />, app);
    await paste(enrolLink());
    expect(screen.getByTestId('enrol-error')).toHaveTextContent(en.enrol.errors.unavailable);
    fireEvent.changeText(screen.getByTestId('enrol-link'), 'x');
    expect(screen.queryByTestId('enrol-error')).toBeNull();
  });

  it('tells the person how long to wait when the server limits enrolment', async () => {
    const app = buildApp();
    app.door.overviewStatus = 429;
    await renderApp(<EnrolScreen />, app);
    await paste(enrolLink());
    expect(screen.getByTestId('enrol-error')).toHaveTextContent(/1 minute/);
  });

  it('opens the sign-in screens for organizers and exhibitors', async () => {
    await renderApp(<EnrolScreen />);
    fireEvent.press(screen.getByTestId('enrol-organizer'));
    expect(router.push).toHaveBeenCalledWith('/sign-in/organizer');
    fireEvent.press(screen.getByTestId('enrol-exhibitor'));
    expect(router.push).toHaveBeenCalledWith('/sign-in/exhibitor');
  });
});

describe('a revoked or wiped device', () => {
  it.each([
    ['revoked', en.enrol.notices.revoked],
    ['wiped', en.enrol.notices.wiped],
  ] as const)('shows why a %s device is back here, and the notice can be dismissed', async (status, text) => {
    const storage = memoryKeyValueStore({
      [ENDED_KEY]: JSON.stringify({ status, wipeDone: true }),
    });
    await renderApp(<EnrolScreen />, buildApp({ storage }));
    expect(screen.getByTestId('enrol-ended')).toHaveTextContent(text);
    fireEvent.press(screen.getByTestId('enrol-ended-dismiss'));
    await settle();
    expect(screen.queryByTestId('enrol-ended')).toBeNull();
  });

  it('a device that was wiped while the screen is open returns to this screen with the notice', async () => {
    const app = buildApp();
    expect(await app.device.enrol(enrolLink())).toEqual({ kind: 'enrolled' });
    await renderApp(<EnrolScreen />, app);
    app.door.wiping.add(TOKEN);
    await act(async () => {
      await app.device.heartbeat();
    });
    await settle();
    expect(screen.getByTestId('enrol-ended')).toHaveTextContent(en.enrol.notices.wiped);
    expect(app.storage.data.has(DEVICE_KEY)).toBe(false);
  });
});

describe('an enrolment link opened from outside', () => {
  it('enrols from the route params, clears the key from the route and never sends it in a URL', async () => {
    state.params = { event: EVENT_ID, key: TOKEN };
    const { app } = await renderApp(<EnrolScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(router.setParams).toHaveBeenCalledWith({ event: undefined, key: undefined, invalid: undefined });
    expect(app.device.state.status).toBe('enrolled');
    for (const call of app.door.calls) expect(call.url).not.toContain(TOKEN);
  });

  it('says so when the link was not an enrolment link', async () => {
    state.params = { invalid: '1' };
    await renderApp(<EnrolScreen />);
    expect(screen.getByTestId('enrol-error')).toHaveTextContent(en.enrol.errors.invalid_link);
  });

  it('says so when the link has a malformed key', async () => {
    state.params = { event: EVENT_ID, key: 'yyd_short' };
    const { app } = await renderApp(<EnrolScreen />);
    expect(screen.getByTestId('enrol-error')).toHaveTextContent(en.enrol.errors.invalid_link);
    expect(app.door.calls).toHaveLength(0);
  });

  it('asks before replacing an enrolled device, and erases only when confirmed', async () => {
    const app = buildApp();
    app.door.valid.add(OTHER_TOKEN);
    await app.device.enrol(enrolLink());
    const wiped = jest.fn();
    app.device.onWipe(wiped);
    state.params = { event: EVENT_ID, key: OTHER_TOKEN };
    await renderApp(<EnrolScreen />, app);
    expect(screen.getByTestId('enrol-replace')).toBeOnTheScreen();
    expect(screen.getByText(en.enrol.replace.body.replace('{event}', 'Summit'))).toBeOnTheScreen();
    expect(app.device.state.token).toBe(TOKEN);

    fireEvent.press(screen.getByTestId('enrol-replace-cancel'));
    expect(screen.queryByTestId('enrol-replace')).toBeNull();
    expect(wiped).not.toHaveBeenCalled();
    expect(app.device.state.token).toBe(TOKEN);
  });

  it('replaces the enrolment after the person confirms', async () => {
    const app = buildApp();
    app.door.valid.add(OTHER_TOKEN);
    await app.device.enrol(enrolLink());
    const wiped = jest.fn();
    app.device.onWipe(wiped);
    state.params = { event: EVENT_ID, key: OTHER_TOKEN };
    await renderApp(<EnrolScreen />, app);
    fireEvent.press(screen.getByTestId('enrol-replace-confirm'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(wiped).toHaveBeenCalledWith('replaced');
    expect(app.device.state.token).toBe(OTHER_TOKEN);
  });
});

describe('accessibility and right to left', () => {
  it('gives every control a role and a label, at least 44 points tall', async () => {
    await renderApp(<EnrolScreen />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) {
      expect(b.props.accessibilityLabel).toBeTruthy();
      const style = Object.assign({}, ...[b.props.style].flat(2).filter(Boolean));
      const resolved =
        typeof b.props.style === 'function' ? b.props.style({ pressed: false }) : b.props.style;
      const flat = Object.assign({}, ...[resolved].flat(2).filter(Boolean));
      expect(Math.max(style.minHeight ?? 0, flat.minHeight ?? 0)).toBeGreaterThanOrEqual(44);
    }
    expect(screen.getByLabelText(en.enrol.linkLabel).props.accessibilityLabel).toBe(en.enrol.linkLabel);
  });

  it('renders in Arabic, right to left, with the Arabic labels', async () => {
    await renderApp(<EnrolScreen />, buildApp({ locale: 'ar' }));
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(screen.getByRole('header', { name: catalogs.ar.enrol.title })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: catalogs.ar.enrol.scan })).toBeOnTheScreen();
    expect(screen.getByLabelText(catalogs.ar.enrol.linkLabel)).toBeOnTheScreen();
    expect(catalogs.ar.enrol.title).not.toBe(en.enrol.title);
    expect(screen.getByRole('header', { name: catalogs.ar.enrol.title })).toHaveStyle({ textAlign: 'auto' });
  });

  it('shows the Arabic error text for a refused code', async () => {
    await renderApp(<EnrolScreen />, buildApp({ locale: 'ar' }));
    fireEvent.changeText(screen.getByTestId('enrol-link'), 'hello');
    fireEvent.press(screen.getByTestId('enrol-submit'));
    await settle();
    expect(screen.getByTestId('enrol-error')).toHaveTextContent(catalogs.ar.enrol.errors.invalid_link);
  });
});
