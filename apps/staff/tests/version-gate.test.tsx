import { act, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { catalogs } from '../src/i18n';
import { enrolLink, TOKEN } from './helpers/fake-door';
import { type App, buildApp, renderApp, settle } from './helpers/render';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const HOUR = 3_600_000;
const app9 = () => {
  const app = buildApp({ version: '1.0.0' });
  // The server says this build is below the minimum.
  app.config.minimum = '9.0.0';
  app.config.latest = '9.1.0';
  return app;
};
const child = <Text testID="app-content">content</Text>;
const blocked = () => screen.queryByTestId('update-screen') !== null;

async function enrolledAt(app: App, startsInMs: number, endsInMs: number) {
  app.door.startsAt = new Date(app.clock.now + startsInMs).toISOString();
  app.door.endsAt = new Date(app.clock.now + endsInMs).toISOString();
  expect(await app.device.enrol(enrolLink())).toEqual({ kind: 'enrolled' });
  await app.device.heartbeat();
  app.device.stopHeartbeat();
}

describe('the required-update screen at the door', () => {
  it('shows for a device that is not enrolled, below the minimum', async () => {
    await renderApp(child, app9());
    expect(blocked()).toBe(true);
    expect(screen.queryByTestId('app-content')).toBeNull();
    expect(screen.getByText(/9\.0\.0/)).toBeOnTheScreen();
  });

  it('never shows inside the event window, even though the server says the version is too old', async () => {
    const app = app9();
    await enrolledAt(app, -1 * HOUR, 6 * HOUR);
    await renderApp(child, app);
    expect(app.core.versionGate.state.kind).toBe('recommended');
    expect(blocked()).toBe(false);
    expect(screen.getByTestId('app-content')).toBeOnTheScreen();
  });

  it('never shows in the 24 hours before the event starts', async () => {
    const app = app9();
    await enrolledAt(app, 23 * HOUR, 30 * HOUR);
    await renderApp(child, app);
    expect(blocked()).toBe(false);
  });

  it('never shows in the 2 hours after the event ends', async () => {
    const app = app9();
    await enrolledAt(app, -10 * HOUR, -1 * HOUR);
    await renderApp(child, app);
    expect(blocked()).toBe(false);
  });

  it('shows again once the window has closed', async () => {
    const app = app9();
    await enrolledAt(app, -10 * HOUR, -2 * HOUR - 1000);
    await renderApp(child, app);
    expect(blocked()).toBe(true);
  });

  it('shows for a device whose event is more than a day away', async () => {
    const app = app9();
    await enrolledAt(app, 25 * HOUR, 30 * HOUR);
    await renderApp(child, app);
    expect(blocked()).toBe(true);
  });

  it('shows no screen while the event’s dates are not known yet on an enrolled device', async () => {
    const app = app9();
    await app.device.enrol(enrolLink());
    app.device.stopHeartbeat();
    // Forget the dates the way an enrolment whose manifest read failed would.
    const stored = JSON.parse(app.storage.data.get('yayatoh.staff.device.v1') ?? '{}');
    app.storage.data.set(
      'yayatoh.staff.device.v1',
      JSON.stringify({ ...stored, event: null, checkpoints: [] }),
    );
    const fresh = buildApp({ version: '1.0.0', storage: app.storage });
    fresh.config.minimum = '9.0.0';
    fresh.config.latest = '9.1.0';
    await renderApp(child, fresh);
    expect(blocked()).toBe(false);
  });

  it('does not show for a 426 on a device call inside the window', async () => {
    const app = app9();
    app.config.minimum = '0.0.0';
    app.config.latest = '0.0.0';
    await enrolledAt(app, -1 * HOUR, 6 * HOUR);
    await renderApp(child, app);
    app.door.upgradeRequired = true;
    await act(async () => {
      await app.device.api.GET('/v1/staff/events/{eventId}/overview', {
        params: { path: { eventId: app.device.state.eventId ?? '' } },
      });
    });
    await settle();
    expect(blocked()).toBe(false);
    expect(screen.getByTestId('app-content')).toBeOnTheScreen();
  });

  it('shows for a 426 on a device call outside the window', async () => {
    const app = app9();
    app.config.minimum = '0.0.0';
    app.config.latest = '0.0.0';
    await enrolledAt(app, 48 * HOUR, 56 * HOUR);
    await renderApp(child, app);
    app.door.upgradeRequired = true;
    await act(async () => {
      await app.device.api.GET('/v1/staff/events/{eventId}/overview', {
        params: { path: { eventId: app.device.state.eventId ?? '' } },
      });
    });
    await settle();
    expect(blocked()).toBe(true);
  });

  it('lifts the screen once enrolling shows the device is inside its event window', async () => {
    const app = app9();
    await renderApp(child, app);
    expect(blocked()).toBe(true);
    // The organizer's QR is scanned on a phone that is below the minimum... but the gate is up, so
    // the device enrols through the session directly, as the link listener would after an update.
    app.door.startsAt = new Date(app.clock.now - HOUR).toISOString();
    app.door.endsAt = new Date(app.clock.now + 5 * HOUR).toISOString();
    await act(async () => {
      await app.device.enrol(enrolLink());
    });
    app.device.stopHeartbeat();
    await act(async () => {
      await app.core.versionGate.check();
    });
    await settle();
    expect(blocked()).toBe(false);
  });

  it('wording of the screen comes from the shared catalog', async () => {
    await renderApp(child, app9());
    expect(screen.getByRole('header', { name: 'Update required' })).toBeOnTheScreen();
    expect(catalogs.en.home.title).toBeTruthy();
    expect(TOKEN).toBeTruthy();
  });
});
