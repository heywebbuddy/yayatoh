import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import SelectScreen from '../src/app/select/index';
import { DEVICE_KEY } from '../src/device/session';
import { catalogs } from '../src/i18n';
import { CHECKPOINTS, EVENT_ID, enrolLink, TOKEN } from './helpers/fake-door';
import { type App, buildApp, missingMessages, renderApp, settle, shownTexts } from './helpers/render';
import { resetRouter, router } from './helpers/router-mock';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const en = catalogs.en;
beforeEach(resetRouter);

async function enrolledApp(opts: Parameters<typeof buildApp>[0] = {}): Promise<App> {
  const app = buildApp(opts);
  expect(await app.device.enrol(enrolLink())).toEqual({ kind: 'enrolled' });
  await app.device.heartbeat();
  app.device.stopHeartbeat();
  return app;
}

describe('the event and checkpoint picker', () => {
  it('sends a device that is not enrolled back to enrolment', async () => {
    await renderApp(<SelectScreen />);
    expect(screen.getByTestId('redirect')).toHaveTextContent('/enrol');
  });

  it('shows the enrolled event, its dates in the event’s time zone, and every place to scan', async () => {
    const app = await enrolledApp();
    await renderApp(<SelectScreen />, app);
    expect(screen.getByRole('header', { name: en.device.select.title })).toBeOnTheScreen();
    expect(screen.getByTestId('select-event')).toHaveTextContent(/Summit/);
    // 2026-10-14 13:00 UTC is 14:00 in Lisbon (summer time ended on 2026-10-25, so UTC+1).
    expect(screen.getByTestId('select-dates')).toHaveTextContent(/Oct 14, 2026/);
    expect(screen.getByTestId('select-dates')).toHaveTextContent(/2:00 PM/);
    expect(screen.getByTestId('select-whole-event')).toBeOnTheScreen();
    for (const c of CHECKPOINTS) expect(screen.getByRole('button', { name: c.name })).toBeOnTheScreen();
    expect(missingMessages(shownTexts())).toEqual([]);
  });

  it('chooses a checkpoint, remembers it, reports it, and goes to the scanner', async () => {
    const app = await enrolledApp();
    await renderApp(<SelectScreen />, app);
    const [first] = CHECKPOINTS;
    fireEvent.press(screen.getByTestId(`select-checkpoint-${first?.id}`));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/scan'));
    expect(app.device.state).toMatchObject({ checkpointId: first?.id, checkpointChosen: true });
    expect(JSON.parse(app.storage.data.get(DEVICE_KEY) ?? '{}').checkpointId).toBe(first?.id);
    await settle();
    const beats = app.door.calls.filter((c) => c.url.endsWith('/devices/heartbeat'));
    expect(beats.at(-1)?.body).toMatchObject({ checkpointId: first?.id, eventId: EVENT_ID });
  });

  it('can scan at the whole event', async () => {
    const app = await enrolledApp();
    await renderApp(<SelectScreen />, app);
    fireEvent.press(screen.getByTestId('select-whole-event'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/scan'));
    expect(app.device.state).toMatchObject({ checkpointId: null, checkpointChosen: true });
  });

  it('marks the current choice in words, not only by state, and offers to continue', async () => {
    const app = await enrolledApp();
    await app.device.selectCheckpoint(CHECKPOINTS[1]?.id ?? null);
    await renderApp(<SelectScreen />, app);
    const chosen = screen.getByTestId(`select-checkpoint-${CHECKPOINTS[1]?.id}`);
    expect(chosen.props.accessibilityLabel).toBe(
      en.device.select.selectedOption.replace('{name}', 'VIP lane'),
    );
    expect(chosen.props.accessibilityState).toMatchObject({ selected: true });
    expect(
      screen.getByTestId(`select-checkpoint-${CHECKPOINTS[0]?.id}`).props.accessibilityState.selected,
    ).toBeFalsy();
    fireEvent.press(screen.getByTestId('select-continue'));
    expect(router.replace).toHaveBeenCalledWith('/scan');
  });

  it('does not offer to continue before a place was chosen', async () => {
    await renderApp(<SelectScreen />, await enrolledApp());
    expect(screen.queryByTestId('select-continue')).toBeNull();
  });

  it('says when the event’s places could not be loaded, and loads them on retry', async () => {
    const app = buildApp();
    const original = app.door.fetch;
    let manifestUp = false;
    app.door.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/manifest') && !manifestUp) throw new TypeError('offline');
      return original(input, init);
    };
    await app.device.enrol(enrolLink());
    app.device.stopHeartbeat();
    await renderApp(<SelectScreen />, app);
    expect(screen.getByTestId('select-unavailable')).toHaveTextContent(en.device.select.unavailable);
    expect(screen.getByTestId('select-whole-event')).toBeOnTheScreen();
    manifestUp = true;
    fireEvent.press(screen.getByTestId('select-retry'));
    await settle();
    await waitFor(() => expect(screen.queryByTestId('select-unavailable')).toBeNull());
    expect(screen.getByTestId('select-event')).toHaveTextContent(/Summit/);
    expect(screen.getByRole('button', { name: CHECKPOINTS[0]?.name ?? '' })).toBeOnTheScreen();
  });

  it('says so when the device may not scan at that place', async () => {
    const app = await enrolledApp();
    const spy = jest.spyOn(app.device, 'selectCheckpoint').mockResolvedValue(false);
    await renderApp(<SelectScreen />, app);
    fireEvent.press(screen.getByTestId('select-whole-event'));
    await waitFor(() =>
      expect(screen.getByTestId('select-refused')).toHaveTextContent(en.device.select.refused),
    );
    expect(router.replace).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('shows a very long place name in full, wrapping rather than cutting it off', async () => {
    const app = await enrolledApp();
    const long = 'North entrance, ground floor, beside the accessible ramp and the coat check desk';
    const original = app.door.fetch;
    app.door.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes('/manifest')) return response;
      const body = await response.json();
      body.header.checkpoints[0].name = long;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    await app.device.refreshEvent();
    await renderApp(<SelectScreen />, app);
    const button = screen.getByRole('button', { name: long });
    expect(button).toBeOnTheScreen();
    expect(screen.getByText(long).props.numberOfLines).toBeUndefined();
  });
});

describe('removing the device', () => {
  it('asks first, and cancelling keeps the enrolment', async () => {
    const app = await enrolledApp();
    await renderApp(<SelectScreen />, app);
    fireEvent.press(screen.getByTestId('select-remove'));
    expect(screen.getByTestId('select-remove-confirm')).toHaveTextContent(
      new RegExp(en.device.select.removeBody.slice(0, 30)),
    );
    fireEvent.press(screen.getByTestId('select-remove-no'));
    expect(screen.queryByTestId('select-remove-confirm')).toBeNull();
    expect(app.device.state.status).toBe('enrolled');
  });

  it('erases the token and the data, then returns to enrolment', async () => {
    const app = await enrolledApp();
    const wiped = jest.fn();
    app.device.onWipe(wiped);
    await renderApp(<SelectScreen />, app);
    fireEvent.press(screen.getByTestId('select-remove'));
    fireEvent.press(screen.getByTestId('select-remove-yes'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/enrol'));
    expect(wiped).toHaveBeenCalledWith('forgotten');
    expect(app.storage.data.has(DEVICE_KEY)).toBe(false);
    expect(JSON.stringify([...app.storage.data.values()])).not.toContain(TOKEN);
  });
});

describe('accessibility and right to left', () => {
  it('labels every control and keeps it at least 44 points tall', async () => {
    await renderApp(<SelectScreen />, await enrolledApp());
    for (const b of screen.getAllByRole('button')) {
      expect(b.props.accessibilityLabel).toBeTruthy();
      const style = typeof b.props.style === 'function' ? b.props.style({ pressed: false }) : b.props.style;
      expect(Object.assign({}, ...[style].flat(2).filter(Boolean)).minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('renders in Arabic, right to left', async () => {
    const app = await enrolledApp({ locale: 'ar' });
    await renderApp(<SelectScreen />, app);
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(screen.getByRole('header', { name: catalogs.ar.device.select.title })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: catalogs.ar.device.select.wholeEvent })).toBeOnTheScreen();
    expect(screen.getByTestId('select-remove')).toBeOnTheScreen();
    expect(missingMessages(shownTexts())).toEqual([]);
  });
});
