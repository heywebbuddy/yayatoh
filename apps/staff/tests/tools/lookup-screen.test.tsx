import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { YayatohApiError } from '@yayatoh/sdk';
import { LookupScreen } from '../../src/tools/screens/lookup';
import { fakeStaff, row, SALT } from './fixtures';
import { en, makeDeps, renderTool } from './harness';

async function savedManifest() {
  return {
    salt: SALT,
    origin: 'device' as const,
    rows: [
      await row({ ticketId: 't1', shortCode: 'ADA00001', holderName: 'Ada Lovelace', email: 'ada@example.test', phone: '+14155550134' }),
      await row({ ticketId: 't2', shortCode: 'VOID0002', holderName: 'Adele Goldberg', status: 'void', email: 'adele@example.test' }),
    ],
    admittedToday: (id: string) => id === 'none',
  };
}

async function search(text: string) {
  fireEvent.changeText(await screen.findByTestId('lookup-query'), text);
  await act(async () => {
    fireEvent.press(screen.getByTestId('lookup-search'));
  });
}

describe('Lookup screen', () => {
  it('finds a guest by name in the list saved on the phone', async () => {
    const src = await savedManifest();
    renderTool(<LookupScreen />, { deps: makeDeps({ manifest: async () => src }) });
    expect(await screen.findByText(en.tools.lookup.sourceDevice)).toBeOnTheScreen();
    await search('ada love');
    expect(await screen.findByText('Ada Lovelace')).toBeOnTheScreen();
    expect(screen.getByText('1 match')).toBeOnTheScreen();
    expect(screen.getByText('General admission · Code ADA00001')).toBeOnTheScreen();
  });

  it('finds a guest by email and by phone through the salted hashes', async () => {
    const src = await savedManifest();
    renderTool(<LookupScreen />, { deps: makeDeps({ manifest: async () => src }) });
    await search('ADA@example.test');
    expect(await screen.findByText('Ada Lovelace')).toBeOnTheScreen();
    await search('+1 415 555 0134');
    await waitFor(() => expect(screen.getByText('1 match')).toBeOnTheScreen());
    expect(screen.getByText('Ada Lovelace')).toBeOnTheScreen();
  });

  it('downloads the list through the staff route when the phone has none saved', async () => {
    const staff = fakeStaff({
      manifestPage: async () => ({ salt: SALT, rows: [await row({ holderName: 'Grace Hopper', shortCode: 'GRC00001' })], cursor: null, complete: true }),
    });
    renderTool(<LookupScreen />, { deps: makeDeps({ staff }) });
    expect(await screen.findByText(en.tools.lookup.sourceDownload)).toBeOnTheScreen();
    await search('grace');
    expect(await screen.findByText('Grace Hopper')).toBeOnTheScreen();
    expect(staff.manifestPage).toHaveBeenCalledTimes(1);
  });

  it('says the list is not on the phone yet when offline with nothing saved', async () => {
    renderTool(<LookupScreen />, { deps: makeDeps({ useOffline: () => true }) });
    expect(await screen.findByText(en.tools.lookup.unavailable)).toBeOnTheScreen();
    expect(screen.getByTestId('lookup-search')).toBeDisabled();
  });

  it('shows an error with a retry when the download fails', async () => {
    const staff = fakeStaff({ manifestPage: jest.fn().mockRejectedValueOnce(new TypeError('x')).mockResolvedValue({ salt: SALT, rows: [], cursor: null, complete: true }) as never });
    renderTool(<LookupScreen />, { deps: makeDeps({ staff }) });
    expect(await screen.findByText(en.tools.lookup.loadFailed)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByText(en.tools.lookup.sourceDownload)).toBeOnTheScreen();
  });

  it('asks for two letters, and says when no one is found', async () => {
    const src = await savedManifest();
    renderTool(<LookupScreen />, { deps: makeDeps({ manifest: async () => src }) });
    await search('a');
    expect(await screen.findByText(`! ${en.tools.lookup.tooShort}`)).toBeOnTheScreen();
    await search('zzzz');
    expect(await screen.findByText(en.tools.lookup.none)).toBeOnTheScreen();
    expect(screen.getByText(en.tools.lookup.noneBody)).toBeOnTheScreen();
  });

  it('does not let a voided pass be checked in', async () => {
    const src = await savedManifest();
    renderTool(<LookupScreen />, { deps: makeDeps({ manifest: async () => src }) });
    await search('adele');
    expect(await screen.findByText(en.tools.lookup.voidPass)).toBeOnTheScreen();
    expect(screen.getByTestId('checkin-VOID0002')).toBeDisabled();
  });

  it('never shows contact details or hashes of a match', async () => {
    const src = await savedManifest();
    renderTool(<LookupScreen />, { deps: makeDeps({ manifest: async () => src }) });
    await search('ada@example.test');
    await screen.findByText('Ada Lovelace');
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toContain('emailHash');
    expect(text).not.toContain('Hash');
    expect(text).not.toContain('5555');
  });

  describe('manual check-in', () => {
    async function open(deps = makeDeps()) {
      const src = await savedManifest();
      const d = { ...deps, manifest: async () => src };
      renderTool(<LookupScreen />, { deps: d });
      await search('ada lovelace');
      fireEvent.press(await screen.findByTestId('checkin-ADA00001'));
      return d;
    }

    it('requires a reason', async () => {
      await open();
      fireEvent.press(screen.getByTestId('manual-confirm'));
      expect(await screen.findByText(`! ${en.tools.manual.errors.reason_missing}`)).toBeOnTheScreen();
    });

    it('requires a note for another reason', async () => {
      await open();
      fireEvent.press(screen.getByTestId('reason-other'));
      fireEvent.press(screen.getByTestId('manual-confirm'));
      expect(await screen.findByText(`! ${en.tools.manual.errors.note_missing}`)).toBeOnTheScreen();
    });

    it('checks the guest in online and shows the verdict in words', async () => {
      const deps = await open();
      fireEvent.press(screen.getByTestId('reason-wont_scan'));
      fireEvent.press(screen.getByTestId('manual-confirm'));
      expect(await screen.findByText(en.tools.verdict.admitted)).toBeOnTheScreen();
      expect(deps.staff?.checkIn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ADA00001', checkpointId: deps.device?.checkpointId }),
      );
      fireEvent.press(screen.getByTestId('manual-done'));
      expect(await screen.findByText(en.tools.lookup.admittedHere)).toBeOnTheScreen();
    });

    it('warns about a duplicate and says when the guest first came in', async () => {
      const staff = fakeStaff({
        checkIn: async () => ({ result: 'duplicate', holderName: 'Ada Lovelace', typeName: 'GA', shortCode: 'ADA00001', firstAdmittedAt: '2026-10-20T09:05:00Z' }),
      });
      await open(makeDeps({ staff }));
      fireEvent.press(screen.getByTestId('reason-phone_dead'));
      fireEvent.press(screen.getByTestId('manual-confirm'));
      expect(await screen.findByText(en.tools.verdict.duplicate)).toBeOnTheScreen();
      expect(screen.getByText(/First checked in at/)).toBeOnTheScreen();
    });

    it('decides on the phone when offline and says it will sync', async () => {
      const offlineCheckIn = { scan: jest.fn(async () => ({ verdict: 'admit', holderName: 'Ada Lovelace', typeName: 'GA' })) };
      const staff = fakeStaff();
      await open(makeDeps({ staff, offlineCheckIn, useOffline: () => true }));
      fireEvent.press(screen.getByTestId('reason-lost_ticket'));
      fireEvent.press(screen.getByTestId('manual-confirm'));
      expect(await screen.findByText(en.tools.manual.offlineNote)).toBeOnTheScreen();
      expect(screen.getByText(en.tools.verdict.admitted)).toBeOnTheScreen();
      expect(staff.checkIn).not.toHaveBeenCalled();
    });

    it('says so when there is no way to decide', async () => {
      await open(makeDeps({ staff: null, useOffline: () => true }));
      fireEvent.press(screen.getByTestId('reason-wont_scan'));
      fireEvent.press(screen.getByTestId('manual-confirm'));
      expect(await screen.findByText(en.tools.manual.noWay)).toBeOnTheScreen();
    });

    it('shows an error when the server refuses, and keeps the form so staff can try again', async () => {
      const staff = fakeStaff({ checkIn: async () => { throw new YayatohApiError(new Response(null, { status: 403 }), null); } });
      await open(makeDeps({ staff }));
      fireEvent.press(screen.getByTestId('reason-wont_scan'));
      fireEvent.press(screen.getByTestId('manual-confirm'));
      expect(await screen.findByText(en.tools.manual.failed)).toBeOnTheScreen();
      expect(screen.getByTestId('manual-confirm')).toBeEnabled();
    });

    it('can be cancelled', async () => {
      await open();
      fireEvent.press(screen.getByTestId('manual-cancel'));
      expect(await screen.findByTestId('checkin-ADA00001')).toBeOnTheScreen();
    });

    it('plays the verdict feedback', async () => {
      const feedback = jest.fn();
      await open(makeDeps({ feedback }));
      fireEvent.press(screen.getByTestId('reason-wont_scan'));
      await act(async () => {
        fireEvent.press(screen.getByTestId('manual-confirm'));
      });
      await waitFor(() => expect(feedback).toHaveBeenCalledWith('ok'));
    });
  });
});
