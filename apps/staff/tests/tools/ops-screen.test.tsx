import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { OpsScreen } from '../../src/tools/screens/ops';
import { EVENT, fakeOps, opsView } from './fixtures';
import { en, makeDeps, renderTool } from './harness';

const choice = { org: 'harbor', orgName: 'Harbor Events', eventId: EVENT, eventName: 'Harbor Summit' };
const organizer = (api = fakeOps(), c: typeof choice | null = choice) => ({ api, choice: c, choose: jest.fn() });

describe('Organizer event-day view', () => {
  it('asks the person to sign in as an organizer when there is no account session', async () => {
    renderTool(<OpsScreen />);
    expect(await screen.findByText(en.ops.notSignedIn)).toBeOnTheScreen();
  });

  it('shows the same numbers the API’s ops view returns', async () => {
    const api = fakeOps();
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer(api) }) });
    const v = opsView();
    expect(await screen.findByTestId('ops-checked-in')).toHaveProp('accessibilityLabel', `Checked in: ${v.checkins?.checkedIn}`);
    expect(screen.getByTestId('ops-expected')).toHaveProp('accessibilityLabel', `Expected: ${v.checkins?.expected}`);
    expect(screen.getByText('412 of 900')).toBeOnTheScreen();
    expect(screen.getByText('488 guests still to arrive')).toBeOnTheScreen();
    expect(screen.getByText('Main gate: 300')).toBeOnTheScreen();
    expect(screen.getByText('North gate: 112')).toBeOnTheScreen();
    expect(screen.getByText('Scans per minute: 15.5')).toBeOnTheScreen();
    expect(screen.getByText('Median gap between scans: 3.2 s')).toBeOnTheScreen();
    expect(screen.getByText('About 4 minutes in the queue')).toBeOnTheScreen();
    expect(screen.getByTestId('ops-duplicates')).toHaveProp('accessibilityLabel', 'Duplicates: 6');
    expect(screen.getByTestId('ops-refused')).toHaveProp('accessibilityLabel', 'Refused: 2');
    expect(api.ops).toHaveBeenCalledWith('harbor', EVENT);
  });

  it('shows the throughput per entrance as returned', async () => {
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer() }) });
    await screen.findByTestId('ops-throughput');
    const card = within(screen.getByTestId('ops-throughput'));
    expect(card.getByText('Main gate: 10.5')).toBeOnTheScreen();
    expect(card.getByText('North gate: 5.0')).toBeOnTheScreen();
  });

  it('lists devices and alerts in words', async () => {
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer() }) });
    expect(await screen.findByText(/Gate A iPad · Online · Battery 81% · At Main gate/)).toBeOnTheScreen();
    expect(screen.getByText(/Warning: Devices offline · Open · 1 affected/)).toBeOnTheScreen();
  });

  it('shows the event mode', async () => {
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer() }) });
    expect(await screen.findByText('Live')).toBeOnTheScreen();
  });

  it('says plainly that a section the role or plan excludes is not included', async () => {
    const api = fakeOps({ ops: async () => ({ ...opsView(), throughput: null, alerts: null }) });
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer(api) }) });
    await screen.findByTestId('ops-checkins');
    expect(screen.getAllByText(en.ops.hidden)).toHaveLength(2);
  });

  it('shows empty scan issues and alerts', async () => {
    const api = fakeOps({
      ops: async () => ({
        ...opsView(),
        scanIssues: { counts: [], duplicates: 0, refused: 0, recent: [], asOf: opsView().asOf },
        alerts: { alerts: [] },
        devices: { devices: [], asOf: opsView().asOf },
      }),
    });
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer(api) }) });
    expect(await screen.findByText(en.ops.issues.none)).toBeOnTheScreen();
    expect(screen.getByText(en.ops.alerts.none)).toBeOnTheScreen();
    expect(screen.getByText(en.ops.devices.none)).toBeOnTheScreen();
  });

  it('names a rule it has no words for without showing its internal key', async () => {
    const v = opsView();
    const api = fakeOps({ ops: async () => ({ ...v, alerts: { alerts: [{ ...(v.alerts?.alerts[0] as object), rule: 'secretInternalRule', id: 'x' } as never] } }) });
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer(api) }) });
    expect(await screen.findByText(new RegExp(en.ops.alerts.rule.other))).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain('secretInternalRule');
  });

  it('refreshes on a timer while open', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const api = fakeOps();
      renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer(api) }) });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });
      expect(api.ops).toHaveBeenCalledTimes(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(15_100);
      });
      expect(api.ops.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows an error with a retry', async () => {
    const api = fakeOps({ ops: jest.fn().mockRejectedValueOnce(new TypeError('x')).mockResolvedValue(opsView()) as never });
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer(api) }) });
    expect(await screen.findByText(en.ops.loadFailed)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByTestId('ops-checkins')).toBeOnTheScreen();
  });

  it('says the numbers are the last ones when offline', async () => {
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer(), useOffline: () => true }) });
    expect(await screen.findByText(/Offline: showing the last numbers from/)).toBeOnTheScreen();
  });

  it('is read only: there is nothing to press but the retry and change-event buttons', async () => {
    renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer() }) });
    await screen.findByTestId('ops-checkins');
    expect(screen.getAllByRole('button').map((b) => b.props.testID)).toEqual(['ops-change']);
  });

  describe('choosing the event', () => {
    it('goes straight to the events of a single organization and watches the one chosen', async () => {
      const org = organizer(fakeOps(), null);
      renderTool(<OpsScreen />, { deps: makeDeps({ organizer: org }) });
      fireEvent.press(await screen.findByTestId(`event-${EVENT}`));
      expect(org.choose).toHaveBeenCalledWith(choice);
    });

    it('asks which organization when there are several', async () => {
      const api = fakeOps({
        organizations: async () => [
          { id: 'o1', slug: 'harbor', name: 'Harbor Events' },
          { id: 'o2', slug: 'lakeside', name: 'Lakeside' },
        ],
      });
      renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer(api, null) }) });
      fireEvent.press(await screen.findByTestId('org-lakeside'));
      expect(await screen.findByText('Events of Lakeside')).toBeOnTheScreen();
      expect(api.events).toHaveBeenCalledWith('lakeside');
    });

    it('says when there is no organization or no event', async () => {
      renderTool(<OpsScreen />, { deps: makeDeps({ organizer: organizer(fakeOps({ organizations: async () => [] }), null) }) });
      expect(await screen.findByText(en.ops.picker.noOrgs)).toBeOnTheScreen();
    });

    it('lets the organizer change event', async () => {
      const org = organizer();
      renderTool(<OpsScreen />, { deps: makeDeps({ organizer: org }) });
      fireEvent.press(await screen.findByTestId('ops-change'));
      expect(org.choose).toHaveBeenCalledWith(null);
    });
  });
});
