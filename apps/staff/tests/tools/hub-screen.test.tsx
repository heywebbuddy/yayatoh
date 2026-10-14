import { fireEvent, screen } from '@testing-library/react-native';
import { HubScreen } from '../../src/tools/screens/hub';
import { fakeOps, fakePortal } from './fixtures';
import { en, makeDeps, renderTool } from './harness';

describe('Door tools home', () => {
  it('lists the door tools for an enrolled device and nothing else', async () => {
    renderTool(<HubScreen />);
    for (const id of ['lookup', 'guests', 'assistance', 'today']) expect(await screen.findByTestId(`tile-${id}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('tile-leads')).toBeNull();
    expect(screen.queryByTestId('tile-ops')).toBeNull();
  });

  it('opens a tool', async () => {
    const deps = makeDeps();
    renderTool(<HubScreen />, { deps });
    fireEvent.press(await screen.findByTestId('open-guests'));
    expect(deps.navigate).toHaveBeenCalledWith('/tools/guests');
  });

  it('offers lead retrieval to a signed-in exhibitor rep, and the event-day view to a signed-in organizer', async () => {
    const deps = makeDeps({
      device: null,
      staff: null,
      portal: { api: fakePortal(), sessionKey: '1' },
      organizer: { api: fakeOps(), choice: null, choose: jest.fn() },
    });
    renderTool(<HubScreen />, { deps });
    expect(await screen.findByTestId('tile-leads')).toBeOnTheScreen();
    expect(screen.getByTestId('tile-ops')).toBeOnTheScreen();
    expect(screen.queryByTestId('tile-lookup')).toBeNull();
    fireEvent.press(screen.getByTestId('open-ops'));
    expect(deps.navigate).toHaveBeenCalledWith('/tools/ops');
  });

  it('says what to do when the phone has no role yet', async () => {
    renderTool(<HubScreen />, { deps: makeDeps({ device: null, staff: null }) });
    expect(await screen.findByText(en.tools.hub.none)).toBeOnTheScreen();
  });
});
