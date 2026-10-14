import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { createYayatohClient, YayatohApiError } from '@yayatoh/sdk';
import { createPortalApi, type LeadScanResult } from '../../src/tools/api';
import { createLeadOutbox } from '../../src/tools/leads';
import { LeadDetailScreen, LeadScanScreen, LeadsScreen } from '../../src/tools/screens/leads';
import { fakePortal, lead, setup } from './fixtures';
import { en, makeDeps, offlineSwitch, renderTool } from './harness';

const rep = (api = fakePortal(), owner = 'rep@acme.test') => ({ api, owner });

describe('Lead retrieval home', () => {
  it('asks the person to sign in as an exhibitor when there is no portal session', async () => {
    renderTool(<LeadsScreen />);
    expect(await screen.findByText(en.leads.notSignedIn)).toBeOnTheScreen();
  });

  it('shows the exhibitor, the scope and the leads the rep may see', async () => {
    renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep() }) });
    expect(await screen.findByText('Acme Robotics · Harbor Summit')).toBeOnTheScreen();
    expect(await screen.findByText('Dana Whitfield')).toBeOnTheScreen();
    expect(screen.getByText('Head of Operations · Northwind')).toBeOnTheScreen();
    expect(screen.getByTestId('leads-scope')).toHaveTextContent(en.leads.scope.own);
    expect(screen.getByText('1 lead')).toBeOnTheScreen();
  });

  it('shows the admin’s scope: all of the exhibitor’s leads', async () => {
    const api = fakePortal({ leads: async () => ({ leads: [lead()], scope: 'all' }) });
    renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep(api) }) });
    expect(await screen.findByText(en.leads.scope.all)).toBeOnTheScreen();
  });

  it('shows an empty state with a way to start', async () => {
    const api = fakePortal({ leads: async () => ({ leads: [], scope: 'own' }) });
    renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep(api) }) });
    expect(await screen.findByText(en.leads.empty)).toBeOnTheScreen();
    expect(screen.getByText(en.leads.emptyBody)).toBeOnTheScreen();
  });

  it('searches the leads and says when none match', async () => {
    renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep() }) });
    await screen.findByText('Dana Whitfield');
    fireEvent.changeText(screen.getByTestId('leads-search'), 'zzz');
    expect(await screen.findByText(en.leads.noMatches)).toBeOnTheScreen();
    fireEvent.changeText(screen.getByTestId('leads-search'), 'northwind');
    expect(await screen.findByText('Dana Whitfield')).toBeOnTheScreen();
  });

  it('shows only the fields the attendee shared', async () => {
    const api = fakePortal({
      leads: async () => ({ leads: [lead({ sharedFields: ['company'], name: 'Hidden Name', jobTitle: 'Hidden Title', email: 'hidden@x.test' })], scope: 'own' }),
    });
    renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep(api) }) });
    expect(await screen.findByText('Northwind')).toBeOnTheScreen();
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toContain('Hidden Name');
    expect(text).not.toContain('Hidden Title');
    expect(text).not.toContain('hidden@x.test');
  });

  it('opens a lead', async () => {
    const deps = makeDeps({ portal: rep() });
    renderTool(<LeadsScreen />, { deps });
    fireEvent.press(await screen.findByLabelText('Open the lead for Dana Whitfield'));
    expect(deps.navigate).toHaveBeenCalledWith('/tools/leads/77777777-7777-4777-8777-777777777777');
  });

  it('opens the scanner', async () => {
    const deps = makeDeps({ portal: rep() });
    renderTool(<LeadsScreen />, { deps });
    await screen.findByText('Dana Whitfield');
    fireEvent.press(screen.getByTestId('leads-scan'));
    expect(deps.navigate).toHaveBeenCalledWith('/tools/leads/scan');
  });

  describe('licence and window (P5-4)', () => {
    it.each([
      ['unlicensed', en.leads.gate.no_license],
      ['over_allowance', en.leads.gate.over_allowance],
    ] as const)('stops a rep who is %s from scanning, and says why', async (license, text) => {
      const api = fakePortal({ setup: async () => setup({ license }) });
      renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep(api) }) });
      expect(await screen.findByText(text)).toBeOnTheScreen();
      expect(screen.getByTestId('leads-scan')).toBeDisabled();
    });

    it('waits for the lead terms', async () => {
      const api = fakePortal({ setup: async () => setup({ termsAccepted: false }) });
      renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep(api) }) });
      expect(await screen.findByText(en.leads.gate.terms)).toBeOnTheScreen();
    });

    it('closes capture after the window but keeps the leads', async () => {
      const deps = makeDeps({ portal: rep(), clock: { now: () => new Date('2026-10-23T00:00:00Z'), offsetMs: () => 0 } });
      renderTool(<LeadsScreen />, { deps });
      expect(await screen.findByText(en.leads.gate.closed)).toBeOnTheScreen();
      expect(await screen.findByText('Dana Whitfield')).toBeOnTheScreen();
      expect(screen.getByTestId('leads-scan')).toBeDisabled();
    });

    it('says when lead access has ended', async () => {
      const api = fakePortal({ setup: async () => setup({ capture: { ...setup().capture, accessOpen: false } }) });
      renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep(api) }) });
      expect(await screen.findByText(en.leads.accessEnded)).toBeOnTheScreen();
      expect(api.leads).not.toHaveBeenCalled();
    });

    it('says when the server ends access while the list loads (409)', async () => {
      const api = fakePortal({ leads: async () => { throw new YayatohApiError(new Response(null, { status: 409 }), null); } });
      renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep(api) }) });
      expect(await screen.findByText(en.leads.accessEnded)).toBeOnTheScreen();
    });
  });

  it('shows errors with a retry for the setup and for the list', async () => {
    const api = fakePortal({ setup: jest.fn().mockRejectedValueOnce(new TypeError('x')).mockResolvedValue(setup()) as never });
    renderTool(<LeadsScreen />, { deps: makeDeps({ portal: rep(api) }) });
    expect(await screen.findByText(en.leads.loadFailed)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByText('Dana Whitfield')).toBeOnTheScreen();
  });

  describe('the outbox', () => {
    it('sends scans waiting from an earlier session when the screen opens', async () => {
      const api = fakePortal();
      const deps = makeDeps({ portal: rep(api) });
      const o = createLeadOutbox({ vault: deps.vault, api: null, owner: 'rep@acme.test', newId: () => 'left-over-scan', now: () => new Date('2026-10-20T09:00:00Z') });
      await o.add({ code: 'BADGE-OLD', offline: true });
      renderTool(<LeadsScreen />, { deps });
      await waitFor(() => expect(api.syncScans).toHaveBeenCalledTimes(1));
      expect(api.syncScans.mock.calls[0]?.[0]?.[0]).toMatchObject({ code: 'BADGE-OLD', offline: true });
    });

    it('keeps scans on the phone while offline and says how many wait', async () => {
      const api = fakePortal();
      const deps = makeDeps({ portal: rep(api), useOffline: () => true });
      const o = createLeadOutbox({ vault: deps.vault, api: null, owner: 'rep@acme.test', newId: () => 's1', now: () => new Date() });
      await o.add({ code: 'B1' });
      await o.add({ code: 'B2' });
      renderTool(<LeadsScreen />, { deps });
      expect(await screen.findByText('2 scans waiting to send')).toBeOnTheScreen();
      expect(screen.getByTestId('leads-send')).toBeDisabled();
      expect(api.syncScans).not.toHaveBeenCalled();
    });

    it('explains why a sync was refused', async () => {
      const refusal = new YayatohApiError(new Response(null, { status: 403 }), { code: 'forbidden', reason: 'over_allowance' } as never);
      const api = fakePortal({ syncScans: async () => { throw refusal; } });
      const deps = makeDeps({ portal: rep(api) });
      const o = createLeadOutbox({ vault: deps.vault, api: null, owner: 'rep@acme.test', newId: () => 's1', now: () => new Date() });
      await o.add({ code: 'B1' });
      renderTool(<LeadsScreen />, { deps });
      expect(await screen.findByText(en.leads.syncFailed.over_allowance)).toBeOnTheScreen();
      expect(screen.getByText('1 scan waiting to send')).toBeOnTheScreen();
    });
  });

  describe('one exhibitor’s leads are never visible to another', () => {
    function serverByToken() {
      const leads: Record<string, ReturnType<typeof lead>[]> = {
        yyp_acme: [lead({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Acme Lead' })],
        yyp_globex: [lead({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Globex Lead' })],
      };
      const seen: string[] = [];
      const fetchFake: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const token = /Bearer (\S+)/.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
        seen.push(`${req.method} ${new URL(req.url).pathname} ${token}`);
        const path = new URL(req.url).pathname;
        if (path.endsWith('/portal/leads/setup')) return Response.json(setup());
        if (path.endsWith('/portal/leads')) return Response.json({ leads: leads[token] ?? [], scope: 'own' });
        return new Response('{}', { status: 404 });
      };
      return { fetchFake, seen };
    }

    it('calls the routes with the rep’s own portal token and shows exactly what they return', async () => {
      const { fetchFake, seen } = serverByToken();
      const mk = (token: string) => createPortalApi(createYayatohClient({ baseUrl: 'https://x.test', token, fetch: fetchFake }));
      renderTool(<LeadsScreen />, { deps: makeDeps({ portal: { api: mk('yyp_acme'), owner: 'rep@acme.test' } }) });
      expect(await screen.findByText('Acme Lead')).toBeOnTheScreen();
      expect(screen.queryByText('Globex Lead')).toBeNull();
      expect(seen.every((s) => s.endsWith('yyp_acme'))).toBe(true);
    });

    it('does not show one rep’s cached leads to the next rep on the same phone', async () => {
      const { fetchFake } = serverByToken();
      const mk = (token: string) => createPortalApi(createYayatohClient({ baseUrl: 'https://x.test', token, fetch: fetchFake }));
      const first = renderTool(<LeadsScreen />, { deps: makeDeps({ portal: { api: mk('yyp_acme'), owner: 'rep@acme.test' } }) });
      await screen.findByText('Acme Lead');
      first.unmount();
      renderTool(<LeadsScreen />, { deps: makeDeps({ portal: { api: mk('yyp_globex'), owner: 'rep@globex.test' } }) });
      expect(await screen.findByText('Globex Lead')).toBeOnTheScreen();
      expect(screen.queryByText('Acme Lead')).toBeNull();
    });
  });
});

describe('Scan a badge', () => {
  const Camera = ({ onCode }: { onCode: (c: string) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="camera-read" testID="camera" onPress={() => onCode('BADGE-CAM')}>
        <Text>camera</Text>
      </Pressable>
    );
  };

  async function capture(deps = makeDeps({ portal: rep(), Scanner: Camera })) {
    renderTool(<LeadScanScreen />, { deps });
    fireEvent.press(await screen.findByTestId('camera'));
    await screen.findByTestId('lead-capture');
    return deps;
  }

  it('reads a badge with the camera, then rates, qualifies, annotates and saves online', async () => {
    const api = fakePortal();
    const deps = await capture(makeDeps({ portal: rep(api), Scanner: Camera }));
    fireEvent.press(screen.getByTestId('rating-hot'));
    fireEvent.press(screen.getByTestId('qualifier-Wants demo'));
    fireEvent.changeText(screen.getByTestId('lead-notes'), 'Call after the keynote');
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-save'));
    });
    expect(await screen.findByText(en.leads.capture.savedOnline)).toBeOnTheScreen();
    expect(api.syncScans.mock.calls[0]?.[0]?.[0]).toMatchObject({
      code: 'BADGE-CAM',
      rating: 'hot',
      qualifiers: ['Wants demo'],
      notes: 'Call after the keynote',
      offline: false,
    });
    expect(screen.getByText('Dana Whitfield')).toBeOnTheScreen();
    expect(deps.vaultFiles.size).toBeGreaterThan(0);
  });

  it('types the badge code when there is no camera, and asks for one if it is empty', async () => {
    renderTool(<LeadScanScreen />, { deps: makeDeps({ portal: rep() }) });
    expect(await screen.findByTestId('scanner-off')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('lead-code-use'));
    expect(await screen.findByText(`! ${en.leads.scanner.codeMissing}`)).toBeOnTheScreen();
    fireEvent.changeText(screen.getByTestId('lead-code'), ' BADGE-9 ');
    fireEvent.press(screen.getByTestId('lead-code-use'));
    expect(await screen.findByTestId('lead-capture')).toBeOnTheScreen();
  });

  it('saves on the phone when offline and says it will be sent', async () => {
    const api = fakePortal();
    await capture(makeDeps({ portal: rep(api), Scanner: Camera, useOffline: () => true }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-save'));
    });
    expect(await screen.findByText(en.leads.capture.savedOffline)).toBeOnTheScreen();
    expect(api.syncScans).not.toHaveBeenCalled();
  });

  it('saves on the phone when the send fails for lack of a connection', async () => {
    const api = fakePortal({ syncScans: async () => { throw new TypeError('x'); } });
    await capture(makeDeps({ portal: rep(api), Scanner: Camera }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-save'));
    });
    expect(await screen.findByText(en.leads.capture.savedOffline)).toBeOnTheScreen();
  });

  it('shows why a badge was refused', async () => {
    const api = fakePortal({
      syncScans: async (s): Promise<LeadScanResult[]> => s.map((x) => ({ scanId: x.scanId, status: 'refused', reason: 'wrong_event', lead: null })),
    });
    await capture(makeDeps({ portal: rep(api), Scanner: Camera }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-save'));
    });
    expect(await screen.findByText(en.leads.refused.wrong_event)).toBeOnTheScreen();
  });

  it('says a re-scanned badge was updated', async () => {
    const api = fakePortal({
      syncScans: async (s): Promise<LeadScanResult[]> => s.map((x) => ({ scanId: x.scanId, status: 'rescanned', reason: null, lead: lead() })),
    });
    await capture(makeDeps({ portal: rep(api), Scanner: Camera }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-save'));
    });
    expect(await screen.findByText(en.leads.capture.rescanned)).toBeOnTheScreen();
  });

  it('shows only the consented fields of a captured lead', async () => {
    const api = fakePortal({
      syncScans: async (s): Promise<LeadScanResult[]> => s.map((x) => ({ scanId: x.scanId, status: 'captured', reason: null, lead: lead({ sharedFields: ['company'], name: 'Secret Name' }) })),
    });
    await capture(makeDeps({ portal: rep(api), Scanner: Camera }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-save'));
    });
    await screen.findByText(en.leads.capture.savedOnline);
    expect(screen.getByText('Northwind')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain('Secret Name');
  });

  it('refuses too many qualifiers and notes that are too long', async () => {
    const api = fakePortal({ setup: async () => setup({ qualifiers: Array.from({ length: 11 }, (_, i) => `Q${i}`) }) });
    await capture(makeDeps({ portal: rep(api), Scanner: Camera }));
    for (let i = 0; i < 11; i++) fireEvent.press(screen.getByTestId(`qualifier-Q${i}`));
    fireEvent.press(screen.getByTestId('lead-save'));
    expect(await screen.findByText(`! ${en.leads.capture.errors.too_many_qualifiers}`)).toBeOnTheScreen();
  });

  it('lets the rep scan another badge', async () => {
    await capture();
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-save'));
    });
    fireEvent.press(await screen.findByTestId('lead-next'));
    expect(await screen.findByTestId('camera')).toBeOnTheScreen();
  });

  it('does not scan without a licence, and says why', async () => {
    const api = fakePortal({ setup: async () => setup({ license: 'unlicensed' }) });
    renderTool(<LeadScanScreen />, { deps: makeDeps({ portal: rep(api), Scanner: Camera }) });
    expect(await screen.findByText(en.leads.gate.no_license)).toBeOnTheScreen();
    expect(screen.queryByTestId('camera')).toBeNull();
  });

  it('queues several badges offline and syncs them when the connection returns', async () => {
    const api = fakePortal();
    const net = offlineSwitch(true);
    const deps = makeDeps({ portal: rep(api), Scanner: Camera, useOffline: net.useOffline });
    renderTool(<LeadScanScreen />, { deps });
    for (let i = 0; i < 2; i++) {
      fireEvent.press(await screen.findByTestId('camera'));
      await act(async () => {
        fireEvent.press(await screen.findByTestId('lead-save'));
      });
      await screen.findByText(en.leads.capture.savedOffline);
      fireEvent.press(screen.getByTestId('lead-next'));
    }
    expect(api.syncScans).not.toHaveBeenCalled();
    await act(async () => net.set(false));
    renderTool(<LeadsScreen />, { deps: { ...deps, useOffline: () => false } });
    await waitFor(() => expect(api.syncScans).toHaveBeenCalledTimes(1));
    expect(api.syncScans.mock.calls[0]?.[0]).toHaveLength(2);
  });
});

describe('A lead', () => {
  const ID = '77777777-7777-4777-8777-777777777777';

  it('shows the shared fields, the consent note and the rep’s own rating and notes', async () => {
    renderTool(<LeadDetailScreen leadId={ID} />, { deps: makeDeps({ portal: rep() }) });
    expect(await screen.findByText(en.leads.lead.consent)).toBeOnTheScreen();
    expect(screen.getByText('Name: Dana Whitfield')).toBeOnTheScreen();
    expect(screen.getByText('Email: dana@northwind.test')).toBeOnTheScreen();
    expect(screen.getByText('Scanned 1 time')).toBeOnTheScreen();
  });

  it('says "not shared" for a field the attendee did not share, and never shows the withheld value', async () => {
    const api = fakePortal({ leads: async () => ({ leads: [lead({ sharedFields: ['name'], email: 'dana@northwind.test', company: 'Northwind' })], scope: 'own' }) });
    renderTool(<LeadDetailScreen leadId={ID} />, { deps: makeDeps({ portal: rep(api) }) });
    expect(await screen.findByText(`Email: ${en.leads.lead.notShared}`)).toBeOnTheScreen();
    expect(screen.getByText(`Company: ${en.leads.lead.notShared}`)).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain('dana@northwind.test');
  });

  it('says when an attendee withdrew permission to share their email', async () => {
    const api = fakePortal({ leads: async () => ({ leads: [lead({ emailWithdrawnAt: '2026-10-21T09:00:00Z' })], scope: 'own' }) });
    renderTool(<LeadDetailScreen leadId={ID} />, { deps: makeDeps({ portal: rep(api) }) });
    expect(await screen.findByText(en.leads.lead.emailWithdrawn)).toBeOnTheScreen();
    expect(screen.getByText(`Email: ${en.leads.lead.notShared}`)).toBeOnTheScreen();
  });

  it('saves the rep’s edits', async () => {
    const api = fakePortal();
    renderTool(<LeadDetailScreen leadId={ID} />, { deps: makeDeps({ portal: rep(api) }) });
    fireEvent.press(await screen.findByTestId('rating-cold'));
    fireEvent.press(screen.getByTestId('qualifier-Budget approved'));
    fireEvent.changeText(screen.getByTestId('lead-notes'), 'Not now');
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-save'));
    });
    expect(await screen.findByText(en.leads.lead.saved)).toBeOnTheScreen();
    expect(api.updateLead).toHaveBeenCalledWith(ID, { rating: 'cold', qualifiers: ['Wants demo', 'Budget approved'], notes: 'Not now' });
  });

  it('says when the save failed, and when notes are too long', async () => {
    const api = fakePortal({ updateLead: async () => { throw new TypeError('x'); } });
    renderTool(<LeadDetailScreen leadId={ID} />, { deps: makeDeps({ portal: rep(api) }) });
    fireEvent.changeText(await screen.findByTestId('lead-notes'), 'n'.repeat(2001));
    fireEvent.press(screen.getByTestId('lead-save'));
    expect(await screen.findByText(`! ${en.leads.capture.errors.notes_too_long}`)).toBeOnTheScreen();
    fireEvent.changeText(screen.getByTestId('lead-notes'), 'ok');
    await act(async () => {
      fireEvent.press(screen.getByTestId('lead-save'));
    });
    expect(await screen.findByText(en.leads.lead.saveFailed)).toBeOnTheScreen();
  });

  it('says when the lead is not in the rep’s list (another exhibitor’s lead is a 404 and never loads)', async () => {
    renderTool(<LeadDetailScreen leadId="99999999-9999-4999-8999-999999999999" />, { deps: makeDeps({ portal: rep() }) });
    expect(await screen.findByText(en.leads.lead.notFound)).toBeOnTheScreen();
  });
});
