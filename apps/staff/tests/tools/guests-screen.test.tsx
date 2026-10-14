import { YayatohApiError } from '@yayatoh/sdk';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { GuestsScreen } from '../../src/tools/screens/guests';
import { fakeStaff, snapshot } from './fixtures';
import { en, makeDeps, offlineSwitch, renderTool } from './harness';

const type = async (text: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByTestId('guests-query'), text);
  });
};

describe('Guest list screen', () => {
  it('asks for a search first, then lists parties and guests with their tables', async () => {
    renderTool(<GuestsScreen />);
    expect(await screen.findByText(en.tools.guests.prompt)).toBeOnTheScreen();
    await type('hopper');
    expect(await screen.findByText('Hopper wedding')).toBeOnTheScreen();
    expect(screen.getByText('Grace Hopper')).toBeOnTheScreen();
    expect(screen.getByText('Attending · Table 4')).toBeOnTheScreen();
    expect(screen.getByText('Guest of Grace Hopper')).toBeOnTheScreen();
    expect(screen.queryByText('Turing party')).toBeNull();
  });

  it('filters by label', async () => {
    renderTool(<GuestsScreen />);
    fireEvent.press(await screen.findByTestId('label-Friends'));
    expect(await screen.findByText('Turing party')).toBeOnTheScreen();
    expect(screen.queryByText('Hopper wedding')).toBeNull();
  });

  it('says when no guest matches', async () => {
    renderTool(<GuestsScreen />);
    await type('zzz');
    expect(await screen.findByText(en.tools.guests.none)).toBeOnTheScreen();
  });

  it('shows who already arrived and offers check-in only to the others', async () => {
    renderTool(<GuestsScreen />);
    await type('hopper');
    expect(await screen.findByText(/Arrived at/)).toBeOnTheScreen();
    expect(screen.getByTestId('guest-checkin-g1')).toBeOnTheScreen();
    expect(screen.queryByTestId('guest-checkin-g2')).toBeNull();
  });

  it('checks a guest in online: queued first, sent at once, shown as sent', async () => {
    const staff = fakeStaff();
    const deps = makeDeps({ staff });
    renderTool(<GuestsScreen />, { deps });
    await type('grace');
    await act(async () => {
      fireEvent.press(await screen.findByTestId('guest-checkin-g1'));
    });
    expect(await screen.findByText(en.tools.guests.sent)).toBeOnTheScreen();
    expect(staff.recordArrivals).toHaveBeenCalledTimes(1);
    expect(staff.recordArrivals.mock.calls[0]?.[1]?.[0]).toMatchObject({ guestId: 'g1', source: 'scanner' });
    expect(screen.queryByTestId('guest-checkin-g1')).toBeNull();
  });

  it('queues a check-in while offline and sends it when the connection returns', async () => {
    const staff = fakeStaff();
    const net = offlineSwitch(false);
    const deps = makeDeps({ staff, useOffline: net.useOffline });
    renderTool(<GuestsScreen />, { deps });
    await type('alan');
    await act(async () => net.set(true));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('guest-checkin-g3'));
    });
    expect(await screen.findByText(en.tools.guests.waiting)).toBeOnTheScreen();
    expect(screen.getByText('1 check-in waiting to send')).toBeOnTheScreen();
    expect(staff.recordArrivals).not.toHaveBeenCalled();
    expect(screen.getByTestId('guests-send')).toBeDisabled();
    await act(async () => net.set(false));
    await waitFor(() => expect(staff.recordArrivals).toHaveBeenCalledTimes(1));
  });

  it('flags a guest someone else checked in earlier', async () => {
    const staff = fakeStaff({
      recordArrivals: async (_e, a) => ({ results: a.map((x) => ({ clientId: x.clientId, result: 'already' as const })) }),
    });
    renderTool(<GuestsScreen />, { deps: makeDeps({ staff }) });
    await type('grace');
    await act(async () => {
      fireEvent.press(await screen.findByTestId('guest-checkin-g1'));
    });
    expect(await screen.findByText('Someone checked Grace Hopper in earlier.')).toBeOnTheScreen();
  });

  it('serves the saved copy offline and says so', async () => {
    const deps = makeDeps();
    const first = renderTool(<GuestsScreen />, { deps });
    await screen.findByText(en.tools.guests.prompt);
    first.unmount();
    renderTool(<GuestsScreen />, { deps: { ...deps, useOffline: () => true } });
    expect(await screen.findByTestId('guests-saved')).toBeOnTheScreen();
    await type('hopper');
    expect(await screen.findByText('Grace Hopper')).toBeOnTheScreen();
  });

  it('says the list is not on the phone when offline with nothing saved', async () => {
    renderTool(<GuestsScreen />, { deps: makeDeps({ useOffline: () => true }) });
    expect(await screen.findByText(en.tools.guests.unavailable)).toBeOnTheScreen();
  });

  it('shows an error with a retry when the list cannot be loaded', async () => {
    const staff = fakeStaff({ guests: jest.fn().mockRejectedValueOnce(new YayatohApiError(new Response(null, { status: 500 }), null)).mockResolvedValue(snapshot()) as never });
    renderTool(<GuestsScreen />, { deps: makeDeps({ staff }) });
    expect(await screen.findByText(en.tools.guests.loadFailed)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByText(en.tools.guests.prompt)).toBeOnTheScreen();
  });

  it('shows an empty list', async () => {
    const staff = fakeStaff({ guests: async () => ({ ...snapshot(), parties: [] }) });
    renderTool(<GuestsScreen />, { deps: makeDeps({ staff }) });
    expect(await screen.findByText(en.tools.guests.emptyList)).toBeOnTheScreen();
  });

  it('sends what is waiting on request and says how it went', async () => {
    let up = false;
    const staff = fakeStaff({
      recordArrivals: async (_e, a) => {
        if (!up) throw new TypeError('x');
        return { results: a.map((x) => ({ clientId: x.clientId, result: 'arrived' as const })) };
      },
    });
    renderTool(<GuestsScreen />, { deps: makeDeps({ staff }) });
    await type('alan');
    await act(async () => {
      fireEvent.press(await screen.findByTestId('guest-checkin-g3'));
    });
    await screen.findByText('1 check-in waiting to send');
    await act(async () => {
      fireEvent.press(screen.getByTestId('guests-send'));
    });
    expect(await screen.findByText(en.tools.guests.sendFailed)).toBeOnTheScreen();
    up = true;
    await act(async () => {
      fireEvent.press(screen.getByTestId('guests-send'));
    });
    expect((await screen.findAllByText(en.tools.guests.sent)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('guests-pending')).toBeNull();
  });
});
