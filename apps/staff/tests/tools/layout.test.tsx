import { screen } from '@testing-library/react-native';
import * as RN from 'react-native';
import { AssistanceScreen } from '../../src/tools/screens/assistance';
import { HubScreen } from '../../src/tools/screens/hub';
import { LeadScanScreen, LeadsScreen } from '../../src/tools/screens/leads';
import { LookupScreen } from '../../src/tools/screens/lookup';
import { OpsScreen } from '../../src/tools/screens/ops';
import { TodayScreen } from '../../src/tools/screens/today';
import { WIDE_BREAKPOINT } from '../../src/tools/ui';
import { EVENT, fakeOps, fakePortal } from './fixtures';
import { makeDeps, renderTool } from './harness';

const choice = { org: 'harbor', orgName: 'Harbor Events', eventId: EVENT, eventName: 'Harbor Summit' };

let mockWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 800, scale: 2, fontScale: 1 }),
}));

const width = (w: number) => {
  mockWidth = w;
};

describe('iPad layout', () => {
  it.each([
    ['today', <TodayScreen key="a" />, 'today-screen'],
    ['help requests', <AssistanceScreen key="b" />, 'assistance-screen'],
    ['event day', <OpsScreen key="c" />, 'ops-screen'],
  ])('puts the %s panes side by side on a wide screen and stacks them on a phone', async (_name, ui, id) => {
    const organizer = { api: fakeOps(), choice, choose: jest.fn() };
    width(WIDE_BREAKPOINT + 256);
    const wide = renderTool(ui, { deps: makeDeps({ organizer }) });
    await screen.findByTestId(id);
    expect(RN.StyleSheet.flatten(screen.getByTestId('columns').props.style).flexDirection).toBe('row');
    wide.unmount();

    width(390);
    renderTool(ui, { deps: makeDeps({ organizer }) });
    await screen.findByTestId(id);
    expect(RN.StyleSheet.flatten(screen.getByTestId('columns').props.style).flexDirection).not.toBe('row');
  });

  it('keeps the content in a readable column that never exceeds the maximum width', async () => {
    width(1366);
    renderTool(<HubScreen />);
    await screen.findByTestId('tools-hub');
    const column = screen.UNSAFE_root.findAll(
      (n) => RN.StyleSheet.flatten(n.props?.style)?.maxWidth === 1040,
    );
    expect(column.length).toBeGreaterThan(0);
  });
});

describe('Accessibility of the door tools', () => {
  const screens: [string, () => ReturnType<typeof renderTool>][] = [
    ['hub', () => renderTool(<HubScreen />)],
    ['lookup', () => renderTool(<LookupScreen />)],
    ['help requests', () => renderTool(<AssistanceScreen />)],
    ['today', () => renderTool(<TodayScreen />)],
    [
      'leads',
      () =>
        renderTool(<LeadsScreen />, { deps: makeDeps({ portal: { api: fakePortal(), sessionKey: '1' } }) }),
    ],
    [
      'badge entry',
      () =>
        renderTool(<LeadScanScreen />, {
          deps: makeDeps({ portal: { api: fakePortal(), sessionKey: '1' } }),
        }),
    ],
    [
      'event day',
      () =>
        renderTool(<OpsScreen />, {
          deps: makeDeps({ organizer: { api: fakeOps(), choice, choose: jest.fn() } }),
        }),
    ],
  ];

  it.each(screens)(
    '%s: every button has an accessibility label and is at least 44 points tall',
    async (_n, mount) => {
      mount();
      await screen.findAllByRole('button');
      for (const button of screen.getAllByRole('button')) {
        expect(button.props.accessibilityLabel).toBeTruthy();
        const style = RN.StyleSheet.flatten(button.props.style) ?? {};
        expect(style.minHeight ?? style.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    },
  );

  it.each(screens)('%s: every text field has a label', async (_n, mount) => {
    mount();
    await screen.findAllByRole('button');
    for (const input of screen.UNSAFE_root.findAll(
      (n) => n.props?.placeholderTextColor !== undefined && n.type === RN.TextInput,
    ))
      expect(input.props.accessibilityLabel).toBeTruthy();
  });

  it('never rests on colour alone: a notice carries a glyph and words', async () => {
    renderTool(<TodayScreen />);
    const alert = await screen.findByText(/Warning: Gate B phone battery is at 9%/);
    expect(alert).toBeOnTheScreen();
    expect(screen.getAllByText('!', { includeHiddenElements: true }).length).toBeGreaterThan(0);
  });
});
