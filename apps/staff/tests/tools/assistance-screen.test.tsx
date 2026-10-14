import { act, fireEvent, screen } from '@testing-library/react-native';
import { YayatohApiError } from '@yayatoh/sdk';
import { AssistanceScreen } from '../../src/tools/screens/assistance';
import { fakeStaff, request } from './fixtures';
import { en, makeDeps, renderTool } from './harness';

describe('Help requests screen', () => {
  it('lists open requests with reason, priority, state, guest and place', async () => {
    renderTool(<AssistanceScreen />);
    expect(await screen.findByText('Request #7')).toBeOnTheScreen();
    expect(screen.getByText('Accessibility · High priority · New')).toBeOnTheScreen();
    expect(screen.getByText('Needs a ramp at the north gate')).toBeOnTheScreen();
    expect(screen.getByText('Guest: Sam Rivera')).toBeOnTheScreen();
    expect(screen.getByText('Where: North gate')).toBeOnTheScreen();
  });

  it('says there are no open requests', async () => {
    renderTool(<AssistanceScreen />, {
      deps: makeDeps({ staff: fakeStaff({ assistance: async () => [] }) }),
    });
    expect(await screen.findByText(en.tools.assistance.empty)).toBeOnTheScreen();
  });

  it('shows an error with a retry', async () => {
    const staff = fakeStaff({
      assistance: jest
        .fn()
        .mockRejectedValueOnce(new YayatohApiError(new Response(null, { status: 500 }), null))
        .mockResolvedValue([request()]) as never,
    });
    renderTool(<AssistanceScreen />, { deps: makeDeps({ staff }) });
    expect(await screen.findByText(en.tools.assistance.loadFailed)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByText('Request #7')).toBeOnTheScreen();
  });

  it('claims a request: take, then the list is refreshed', async () => {
    const queue = [[request()], [request({ state: 'assigned', mine: true })]];
    const staff = fakeStaff({ assistance: jest.fn(async () => queue.shift() ?? []) as never });
    renderTool(<AssistanceScreen />, { deps: makeDeps({ staff }) });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('take-7'));
    });
    expect(staff.workAssistance).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: request().id, action: 'take' }),
    );
    expect(await screen.findByText(en.tools.assistance.mine)).toBeOnTheScreen();
    expect(screen.getByTestId('start-7')).toBeOnTheScreen();
    expect(screen.getByTestId('resolve-7')).toBeOnTheScreen();
    expect(screen.queryByTestId('take-7')).toBeNull();
  });

  it('resolves a request this device took', async () => {
    const mine = request({ state: 'in_progress', mine: true });
    const staff = fakeStaff({
      assistance: jest.fn().mockResolvedValueOnce([mine]).mockResolvedValue([]) as never,
    });
    renderTool(<AssistanceScreen />, { deps: makeDeps({ staff }) });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('resolve-7'));
    });
    expect(staff.workAssistance).toHaveBeenCalledWith(expect.objectContaining({ action: 'resolve' }));
    expect(await screen.findByText(en.tools.assistance.empty)).toBeOnTheScreen();
  });

  it('only offers take on a request another device holds, and never start, resolve or cancel', async () => {
    const other = request({
      state: 'assigned',
      mine: false,
      assignee: { kind: 'device', id: 'd', label: 'Gate B' },
    });
    renderTool(<AssistanceScreen />, {
      deps: makeDeps({ staff: fakeStaff({ assistance: async () => [other] }) }),
    });
    await screen.findByText('Request #7');
    expect(screen.getByTestId('take-7')).toBeOnTheScreen();
    expect(screen.queryByTestId('resolve-7')).toBeNull();
    expect(screen.queryByTestId('cancel-7')).toBeNull();
  });

  it('explains a request that changed meanwhile and refreshes', async () => {
    const staff = fakeStaff({
      workAssistance: async () => {
        throw new YayatohApiError(new Response(null, { status: 409 }), null);
      },
    });
    renderTool(<AssistanceScreen />, { deps: makeDeps({ staff }) });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('take-7'));
    });
    expect(await screen.findByText(en.tools.assistance.changed)).toBeOnTheScreen();
    expect(staff.assistance.mock.calls.length).toBeGreaterThan(1);
  });

  it('flags an overdue request', async () => {
    renderTool(<AssistanceScreen />, {
      deps: makeDeps({ staff: fakeStaff({ assistance: async () => [request({ overdue: true })] }) }),
    });
    expect(await screen.findByText(en.tools.assistance.overdue)).toBeOnTheScreen();
  });

  it('gives buttons names that say which request they act on', async () => {
    renderTool(<AssistanceScreen />);
    expect(await screen.findByLabelText('Take request 7')).toBeOnTheScreen();
  });

  describe('asking for help', () => {
    it('needs a reason', async () => {
      renderTool(<AssistanceScreen />);
      fireEvent.press(await screen.findByTestId('raise-send'));
      expect(await screen.findByText(en.tools.assistance.raise.reasonMissing)).toBeOnTheScreen();
    });

    it('sends a request tied to the device’s entrance and confirms it', async () => {
      const staff = fakeStaff();
      const deps = makeDeps({ staff });
      renderTool(<AssistanceScreen />, { deps });
      fireEvent.press(await screen.findByTestId('raise-medical'));
      fireEvent.changeText(screen.getByTestId('raise-note'), ' Fainted near gate A ');
      await act(async () => {
        fireEvent.press(screen.getByTestId('raise-send'));
      });
      expect(staff.raiseAssistance).toHaveBeenCalledWith({
        eventId: deps.device?.eventId,
        reason: 'medical',
        note: 'Fainted near gate A',
        checkpointId: deps.device?.checkpointId,
      });
      expect(await screen.findByText('Request #8 sent.')).toBeOnTheScreen();
    });

    it('says when the request could not be sent', async () => {
      const staff = fakeStaff({
        raiseAssistance: async () => {
          throw new TypeError('x');
        },
      });
      renderTool(<AssistanceScreen />, { deps: makeDeps({ staff }) });
      fireEvent.press(await screen.findByTestId('raise-backup'));
      await act(async () => {
        fireEvent.press(screen.getByTestId('raise-send'));
      });
      expect(await screen.findByText(en.tools.assistance.raise.failed)).toBeOnTheScreen();
    });
  });
});
