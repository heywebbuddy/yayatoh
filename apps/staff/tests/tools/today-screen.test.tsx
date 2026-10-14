import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { TodayScreen } from '../../src/tools/screens/today';
import { fakeStaff, overview } from './fixtures';
import { en, makeDeps, renderTool } from './harness';

describe('Today screen', () => {
  it('shows checked in against expected, per entrance, with the percentage', async () => {
    renderTool(<TodayScreen />);
    expect(await screen.findByText('Harbor Summit')).toBeOnTheScreen();
    expect(screen.getByLabelText('Checked in: 412')).toBeOnTheScreen();
    expect(screen.getByLabelText('Expected: 900')).toBeOnTheScreen();
    expect(screen.getByText('46% of expected')).toBeOnTheScreen();
    expect(screen.getByText('Main gate: 300')).toBeOnTheScreen();
    expect(screen.getByText('North gate: 112')).toBeOnTheScreen();
  });

  it('shows the device board: online, battery, queue, and which device is this one', async () => {
    renderTool(<TodayScreen />);
    expect(await screen.findByText(/Gate A iPad \(This device\) · Online · Battery 81%/)).toBeOnTheScreen();
    expect(screen.getByText(/Gate B phone · Offline · Battery 9% · 14 scans waiting to send/)).toBeOnTheScreen();
  });

  it('lists alerts in words with their severity', async () => {
    renderTool(<TodayScreen />);
    expect(await screen.findByText('Warning: Gate B phone battery is at 9%.')).toBeOnTheScreen();
  });

  it('says when there are no alerts', async () => {
    renderTool(<TodayScreen />, { deps: makeDeps({ staff: fakeStaff({ overview: async () => overview({ alerts: [] }) }) }) });
    expect(await screen.findByText(en.tools.today.noAlerts)).toBeOnTheScreen();
  });

  it('shows the days of a multi-day event', async () => {
    const staff = fakeStaff({
      overview: async () => overview({ byDate: [{ day: '2026-10-20', checkedIn: 412 }, { day: '2026-10-21', checkedIn: 30 }] }),
    });
    renderTool(<TodayScreen />, { deps: makeDeps({ staff }) });
    expect(await screen.findByText('2026-10-21: 30')).toBeOnTheScreen();
  });

  it('shows an error with a retry when the numbers cannot be loaded', async () => {
    const staff = fakeStaff({ overview: jest.fn().mockRejectedValueOnce(new TypeError('x')).mockResolvedValue(overview()) as never });
    renderTool(<TodayScreen />, { deps: makeDeps({ staff }) });
    expect(await screen.findByText(en.tools.today.loadFailed)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByText('Harbor Summit')).toBeOnTheScreen();
  });

  it('says the numbers are the last ones saved while offline', async () => {
    renderTool(<TodayScreen />, { deps: makeDeps({ useOffline: () => true }) });
    expect(await screen.findByText(/Offline: showing the last numbers saved at/)).toBeOnTheScreen();
  });

  describe('alerts on this phone', () => {
    it('turns alerts on: permission, the phone token, and the text in the phone’s language', async () => {
      const staff = fakeStaff();
      const deps = makeDeps({ staff, push: { permission: async () => 'undetermined', request: async () => 'granted', token: async () => ({ platform: 'apns', token: 'apns-token-1234', appId: 'com.yayatoh.staff' }) } });
      renderTool(<TodayScreen />, { deps });
      expect(await screen.findByText(en.tools.push.off)).toBeOnTheScreen();
      await act(async () => {
        fireEvent.press(screen.getByTestId('push-toggle'));
      });
      await waitFor(() => expect(staff.registerPush).toHaveBeenCalledTimes(1));
      const body = staff.registerPush.mock.calls[0]?.[0];
      expect(body).toMatchObject({ platform: 'apns', token: 'apns-token-1234', appId: 'com.yayatoh.staff', locale: 'en' });
      expect(body?.copy.device_low_battery).toEqual({ title: 'Low battery', body: '{label} battery is at {percent}%.' });
      expect(Object.keys(body?.copy ?? {}).sort()).toEqual(['assistance', 'capacity_near', 'device_backlog', 'device_low_battery', 'device_offline']);
    });

    it('sends no personal data in the push text, only the app’s own words', async () => {
      const staff = fakeStaff();
      renderTool(<TodayScreen />, { deps: makeDeps({ staff }) });
      await screen.findByText(en.tools.push.off);
      await act(async () => {
        fireEvent.press(screen.getByTestId('push-toggle'));
      });
      await waitFor(() => expect(staff.registerPush).toHaveBeenCalled());
      const text = JSON.stringify(staff.registerPush.mock.calls[0]?.[0]);
      expect(text).not.toContain('Gate');
      expect(text).not.toContain('Harbor');
    });

    it('explains how to allow notifications when permission is denied, and registers nothing', async () => {
      const staff = fakeStaff();
      const deps = makeDeps({ staff, push: { permission: async () => 'denied', request: async () => 'denied', token: async () => null } });
      renderTool(<TodayScreen />, { deps });
      await screen.findByText(en.tools.push.off);
      await act(async () => {
        fireEvent.press(screen.getByTestId('push-toggle'));
      });
      expect(await screen.findByText(en.tools.push.denied)).toBeOnTheScreen();
      expect(staff.registerPush).not.toHaveBeenCalled();
    });

    it('says when the phone cannot give a token', async () => {
      const deps = makeDeps({ push: { permission: async () => 'granted', request: async () => 'granted', token: async () => null } });
      renderTool(<TodayScreen />, { deps });
      await screen.findByText(en.tools.push.off);
      await act(async () => {
        fireEvent.press(screen.getByTestId('push-toggle'));
      });
      expect(await screen.findByText(en.tools.push.unavailable)).toBeOnTheScreen();
    });

    it('turns alerts off for a device that is registered', async () => {
      const staff = fakeStaff({ pushStatus: async () => ({ subscribed: true, supervisor: false, platform: 'fcm' }) });
      renderTool(<TodayScreen />, { deps: makeDeps({ staff }) });
      expect(await screen.findByText(en.tools.push.on)).toBeOnTheScreen();
      await act(async () => {
        fireEvent.press(screen.getByTestId('push-toggle'));
      });
      await waitFor(() => expect(staff.unregisterPush).toHaveBeenCalledTimes(1));
    });

    it('says when the change failed', async () => {
      const staff = fakeStaff({ registerPush: async () => { throw new TypeError('x'); } });
      renderTool(<TodayScreen />, { deps: makeDeps({ staff }) });
      await screen.findByText(en.tools.push.off);
      await act(async () => {
        fireEvent.press(screen.getByTestId('push-toggle'));
      });
      expect(await screen.findByText(en.tools.push.failed)).toBeOnTheScreen();
    });
  });
});
