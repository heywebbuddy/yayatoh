import { fireEvent, screen } from '@testing-library/react-native';
import { catalogs } from '../../src/i18n';
import { AssistanceScreen } from '../../src/tools/screens/assistance';
import { GuestsScreen } from '../../src/tools/screens/guests';
import { HubScreen } from '../../src/tools/screens/hub';
import { LeadDetailScreen, LeadScanScreen, LeadsScreen } from '../../src/tools/screens/leads';
import { LookupScreen } from '../../src/tools/screens/lookup';
import { OpsScreen } from '../../src/tools/screens/ops';
import { TodayScreen } from '../../src/tools/screens/today';
import { EVENT, fakeOps, fakePortal, row, SALT } from './fixtures';
import { makeDeps, renderTool } from './harness';

const ar = catalogs.ar;
const choice = { org: 'harbor', orgName: 'Harbor Events', eventId: EVENT, eventName: 'Harbor Summit' };
const LEAD = '77777777-7777-4777-8777-777777777777';

describe('Arabic, right to left', () => {
  it('shows the hub in Arabic, mirrored, with an accessibility label on every button', async () => {
    renderTool(<HubScreen />, { locale: 'ar' });
    expect((await screen.findAllByText(ar.tools.hub.lookup)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    for (const b of screen.getAllByRole('button')) expect(b.props.accessibilityLabel).toBeTruthy();
    // Nothing is positioned with left or right: alignment follows the text direction.
    expect(JSON.stringify(screen.toJSON())).not.toMatch(
      /"(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth)"/,
    );
  });

  it('shows the lookup in Arabic, with its search results and the manual check-in', async () => {
    const src = {
      salt: SALT,
      origin: 'device' as const,
      rows: [await row({ ticketId: 't1', shortCode: 'ADA00001', holderName: 'Ada Lovelace' })],
    };
    renderTool(<LookupScreen />, { locale: 'ar', deps: makeDeps({ manifest: async () => src }) });
    expect(await screen.findByText(ar.tools.lookup.sourceDevice)).toBeOnTheScreen();
    fireEvent.changeText(screen.getByTestId('lookup-query'), 'ada');
    fireEvent.press(screen.getByTestId('lookup-search'));
    fireEvent.press(await screen.findByTestId('checkin-ADA00001'));
    expect(await screen.findByText(ar.tools.manual.reasonLabel)).toBeOnTheScreen();
    expect(screen.getByLabelText(ar.tools.manual.reasons.wont_scan)).toBeOnTheScreen();
  });

  it('shows the guest list, help requests and today in Arabic', async () => {
    const guests = renderTool(<GuestsScreen />, { locale: 'ar' });
    expect(await screen.findByText(ar.tools.guests.prompt)).toBeOnTheScreen();
    guests.unmount();
    const help = renderTool(<AssistanceScreen />, { locale: 'ar' });
    expect(await screen.findByText(ar.tools.assistance.number.replace('{number}', '7'))).toBeOnTheScreen();
    expect(screen.getByLabelText(ar.tools.assistance.takeFor.replace('{number}', '7'))).toBeOnTheScreen();
    help.unmount();
    renderTool(<TodayScreen />, { locale: 'ar' });
    expect(await screen.findByText(ar.tools.today.entrances)).toBeOnTheScreen();
  });

  it('shows lead retrieval, the capture form and a lead in Arabic', async () => {
    const deps = makeDeps({ portal: { api: fakePortal(), sessionKey: '1' } });
    const home = renderTool(<LeadsScreen />, { locale: 'ar', deps });
    expect(await screen.findByText(ar.leads.title)).toBeOnTheScreen();
    home.unmount();
    const detail = renderTool(<LeadDetailScreen leadId={LEAD} />, { locale: 'ar', deps });
    expect(await screen.findByText(ar.leads.lead.consent)).toBeOnTheScreen();
    detail.unmount();
    renderTool(<LeadScanScreen />, { locale: 'ar', deps });
    expect(await screen.findByText(ar.leads.scanner.cameraOff)).toBeOnTheScreen();
  });

  it('shows the organizer’s event-day view in Arabic', async () => {
    renderTool(<OpsScreen />, {
      locale: 'ar',
      deps: makeDeps({ organizer: { api: fakeOps(), choice, choose: jest.fn() } }),
    });
    expect(await screen.findByText(ar.ops.readOnly)).toBeOnTheScreen();
    expect(screen.getByText(ar.ops.checkins.title)).toBeOnTheScreen();
  });

  it('uses the plural forms Arabic needs (zero, one, two, few, many, other)', async () => {
    expect(ar.tools.guests.pending).toMatch(/zero/);
    expect(ar.tools.guests.pending).toMatch(/two/);
    expect(ar.tools.guests.pending).toMatch(/few/);
    expect(ar.tools.guests.pending).toMatch(/many/);
  });
});
