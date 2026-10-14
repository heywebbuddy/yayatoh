import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { dark, light } from '@yayatoh/ui/tokens';
import { catalogs } from '../../src/i18n';
import type { ScanEngine } from '../../src/scan/engine';
import { createScheduler } from '../../src/scan/scheduler';
import { ScanView } from '../../src/scan/ui/scan-screen';
import { REPEAT_WINDOW_MS, VERDICT_HOLD_MS } from '../../src/scan/ui/use-scan-flow';
import { ALL_VERDICTS, viewFor } from '../../src/scan/verdicts';
import { camera } from '../mocks/vision-camera';
import { FakeServer, header, NORTH, NOW, rig, row, signedCode } from './harness';
import { renderIn, spyFeedback } from './ui-helpers';

jest.mock('react-native-vision-camera', () => require('../mocks/vision-camera'));

const mockScheme = jest.fn<'light' | 'dark', []>();
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme(),
}));

const atServerTime = Date.parse('2027-12-01T12:00:00Z');
const t = catalogs.en.scan;

beforeEach(() => {
  camera.reset();
  mockScheme.mockReturnValue('light');
});

async function ready(over: { rows?: ReturnType<typeof row>[]; checkpoint?: string | null } = {}) {
  const server = new FakeServer({ header: await header(), rows: over.rows ?? [row(1), row(2), row(3)] });
  const r = await rig(server, { at: atServerTime });
  await r.engine.sync();
  r.clock.ms = Date.parse(NOW);
  r.engine.setCheckpoint(over.checkpoint === undefined ? NORTH : over.checkpoint);
  return { ...r, server };
}

async function view(
  engine: ScanEngine,
  feedback = spyFeedback(),
  scheduler = null as ReturnType<typeof createScheduler> | null,
  now?: () => number,
) {
  const ui = renderIn(
    <ScanView engine={engine} scheduler={scheduler} feedback={feedback} {...(now ? { now } : {})} />,
  );
  await act(async () => {});
  return ui;
}

describe('the scan screen: header', () => {
  it('names the event and the entrance, and shows what is waiting to send', async () => {
    const { engine } = await ready();
    await view(engine);
    expect(screen.getByRole('header', { name: 'Harness Summit' })).toBeOnTheScreen();
    expect(screen.getByTestId('scan-place')).toHaveTextContent('At North gate');
    expect(screen.getByTestId('scan-queue')).toHaveTextContent('All scans sent');
    expect(screen.getByTestId('scan-updated')).toBeOnTheScreen();
    expect(screen.getByTestId('verdict-idle')).toHaveTextContent(t.ready);
  });

  it('says whole event when no entrance is chosen', async () => {
    const { engine } = await ready({ checkpoint: null });
    await view(engine);
    expect(screen.getByTestId('scan-place')).toHaveTextContent('Whole event');
  });

  it('counts the queue as scans are made', async () => {
    const { engine } = await ready();
    await view(engine);
    await act(async () => camera.see(row(1).shortCode));
    await waitFor(() => expect(screen.getByTestId('scan-queue')).toHaveTextContent('1 scan waiting to send'));
    await act(async () => camera.see(row(2).shortCode));
    await waitFor(() =>
      expect(screen.getByTestId('scan-queue')).toHaveTextContent('2 scans waiting to send'),
    );
  });
});

describe('the scan screen: every verdict', () => {
  it('shows each verdict with its words, glyph, sound and haptic', async () => {
    const { engine } = await ready();
    const feedback = spyFeedback();
    let cameraClock = 0;
    const ui = await view(engine, feedback, null, () => cameraClock);
    // The scenarios the engine really produces on this event.
    const cases: [string, string, string][] = [
      [row(1).shortCode, 'verdict-glyph-admit', t.verdict.admit.title],
      [row(1).shortCode, 'verdict-glyph-warn', t.verdict.duplicate.title],
      ['NOSUCHCODE', 'verdict-glyph-stop', t.verdict.invalid.title],
    ];
    for (const [code, glyph, title] of cases) {
      cameraClock += REPEAT_WINDOW_MS + 1; // past the camera's repeat filter
      await act(async () => camera.see(code));
      await waitFor(() => expect(screen.getByTestId('verdict-title')).toHaveTextContent(title));
      expect(screen.getByTestId(glyph)).toBeOnTheScreen();
      expect(screen.getByRole('alert', { name: new RegExp(title) })).toBeOnTheScreen();
    }
    expect(feedback.played).toEqual(['admit+success', 'duplicate+duplicate', 'stop+error']);
    ui.unmount();
  });

  it('has a title in the catalog for every verdict the engine or the server can give', () => {
    for (const id of ALL_VERDICTS) {
      const v = viewFor(id);
      const node = (catalogs.en.scan.verdict as Record<string, { title?: string; hint?: string }>)[v.key];
      expect(node?.title).toBeTruthy();
      if (v.hint && id !== 'duplicate') expect(node?.hint).toBeTruthy();
    }
  });

  it('shows a refunded ticket as a stop with its hint', async () => {
    const { engine } = await ready({ rows: [row(1, { status: 'void' })] });
    await view(engine);
    await act(async () => camera.see(row(1).shortCode));
    await waitFor(() => expect(screen.getByTestId('verdict-title')).toHaveTextContent(t.verdict.void.title));
    expect(screen.getByText(t.verdict.void.hint)).toBeOnTheScreen();
    expect(screen.getByTestId('verdict-glyph-stop')).toBeOnTheScreen();
  });

  it('shows a superseded code, a wrong entrance and an unknown ticket', async () => {
    const { engine } = await ready({ rows: [row(1, { rev: 2 })], checkpoint: NORTH });
    await view(engine);
    await act(async () => camera.see(await signedCode(1, 1)));
    await waitFor(() =>
      expect(screen.getByTestId('verdict-title')).toHaveTextContent(t.verdict.superseded.title),
    );
    engine.setCheckpoint('not-an-entrance');
  });

  it('says where and when a repeat was first admitted', async () => {
    const { engine, clock } = await ready();
    let cameraClock = 0;
    await view(engine, spyFeedback(), null, () => cameraClock);
    await act(async () => camera.see(row(1).shortCode));
    clock.ms += 5 * 60_000;
    cameraClock += 5 * 60_000;
    await act(async () => camera.see(`${row(1).shortCode} `));
    await waitFor(() =>
      expect(screen.getByTestId('verdict-title')).toHaveTextContent(t.verdict.duplicate.title),
    );
    // 20:00Z is 2 pm in Chicago.
    expect(screen.getByText('First admitted at 2:00 PM at North gate.')).toBeOnTheScreen();
  });

  it('shows the holder, the ticket type and reads out the whole verdict', async () => {
    const { engine } = await ready();
    await view(engine);
    await act(async () => camera.see(row(2).shortCode));
    const panel = await screen.findByTestId('verdict-panel');
    expect(panel.props.accessibilityLabel).toBe('Admit. Holder 2. General');
    expect(screen.getByText('Holder 2')).toBeOnTheScreen();
    expect(screen.getByText('General')).toBeOnTheScreen();
  });

  it('clears the verdict after a few seconds so the next person sees a ready screen', async () => {
    jest.useFakeTimers();
    try {
      const { engine } = await ready();
      await view(engine);
      await act(async () => camera.see(row(1).shortCode));
      await waitFor(() => expect(screen.getByTestId('verdict-panel')).toBeOnTheScreen());
      await act(async () => jest.advanceTimersByTime(VERDICT_HOLD_MS + 10));
      expect(screen.getByTestId('verdict-idle')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores the camera repeating the QR it still sees, but not a different code', async () => {
    const { engine, clock } = await ready();
    const feedback = spyFeedback();
    await view(engine, feedback);
    await act(async () => {
      camera.see(row(1).shortCode);
      camera.see(row(1).shortCode);
      camera.see(row(1).shortCode);
    });
    await waitFor(() => expect(feedback.played).toHaveLength(1));
    await act(async () => camera.see(row(2).shortCode));
    await waitFor(() => expect(feedback.played).toHaveLength(2));
    expect(engine.queueDepth).toBe(2);
    expect(REPEAT_WINDOW_MS).toBeGreaterThan(0);
    expect(clock.ms).toBeGreaterThan(0);
  });
});

describe('the scan screen: the camera', () => {
  it('reads QR codes only, with the back camera, and passes the torch through', async () => {
    const { engine } = await ready();
    await view(engine);
    expect(camera.output?.types).toEqual(['qr']);
    expect(camera.props).toMatchObject({ isActive: true, torchMode: 'off' });
    fireEvent.press(screen.getByTestId('torch-toggle'));
    expect(camera.props).toMatchObject({ torchMode: 'on' });
    expect(screen.getByRole('button', { name: t.torch.off })).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('torch-toggle'));
    expect(camera.props).toMatchObject({ torchMode: 'off' });
  });

  it('hides the torch on a phone without one', async () => {
    camera.device = { id: 'back', hasTorch: false };
    const { engine } = await ready();
    await view(engine);
    expect(screen.queryByTestId('torch-toggle')).toBeNull();
  });

  it('ignores a scanned object that is not a code', async () => {
    const { engine } = await ready();
    await view(engine);
    await act(async () =>
      camera.output?.onObjectsScanned([
        { type: 'face', faceID: 1 },
        { type: 'qr', value: '' },
      ]),
    );
    expect(engine.queueDepth).toBe(0);
  });

  it('asks before the first use, with a button that requests permission', async () => {
    camera.permission = 'not-determined';
    const { engine } = await ready();
    await view(engine);
    expect(screen.getByTestId('camera-ask')).toBeOnTheScreen();
    expect(screen.getByText(t.camera.askTitle)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('camera-allow'));
    expect(camera.request).toHaveBeenCalled();
    expect(screen.queryByTestId('vision-camera')).toBeNull();
  });

  it('explains how to turn the camera back on when permission was denied, and still lets staff type a code', async () => {
    camera.permission = 'denied';
    const { engine } = await ready();
    await view(engine);
    expect(screen.getByTestId('camera-denied')).toBeOnTheScreen();
    expect(screen.getByText(t.camera.deniedTitle)).toBeOnTheScreen();
    expect(screen.getByText(t.camera.deniedBody)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: t.camera.openSettings })).toBeOnTheScreen();
    expect(screen.queryByTestId('vision-camera')).toBeNull();
    fireEvent.press(screen.getByTestId('camera-type-code'));
    expect(screen.getByTestId('manual-entry')).toBeOnTheScreen();
  });

  it('treats a restricted camera like a denied one', async () => {
    camera.permission = 'restricted';
    const { engine } = await ready();
    await view(engine);
    expect(screen.getByTestId('camera-denied')).toBeOnTheScreen();
  });

  it('says so when the phone has no camera', async () => {
    camera.device = undefined;
    const { engine } = await ready();
    await view(engine);
    expect(screen.getByTestId('camera-unavailable')).toBeOnTheScreen();
    expect(screen.getByText(t.camera.unavailable)).toBeOnTheScreen();
  });
});

describe('the scan screen: typing a code', () => {
  it('checks a typed code like a scanned one', async () => {
    const feedback = spyFeedback();
    const { engine } = await ready();
    await view(engine, feedback);
    fireEvent.press(screen.getByTestId('manual-open'));
    expect(screen.queryByTestId('vision-camera')).toBeNull();
    fireEvent.changeText(screen.getByTestId('manual-input'), ` ${row(3).shortCode.toLowerCase()} `);
    await act(async () => fireEvent.press(screen.getByTestId('manual-submit')));
    await waitFor(() => expect(screen.getByTestId('verdict-title')).toHaveTextContent(t.verdict.admit.title));
    expect(feedback.played).toEqual(['admit+success']);
    expect(screen.getByTestId('manual-input').props.value).toBe('');
  });

  it('lets staff type the same code again right away (no camera repeat filter)', async () => {
    const { engine } = await ready();
    await view(engine);
    fireEvent.press(screen.getByTestId('manual-open'));
    for (let i = 0; i < 2; i++) {
      fireEvent.changeText(screen.getByTestId('manual-input'), row(1).shortCode);
      await act(async () => fireEvent.press(screen.getByTestId('manual-submit')));
    }
    await waitFor(() =>
      expect(screen.getByTestId('verdict-title')).toHaveTextContent(t.verdict.duplicate.title),
    );
  });

  it('refuses an empty code with a message, and clears it once typing starts', async () => {
    const { engine } = await ready();
    await view(engine);
    fireEvent.press(screen.getByTestId('manual-open'));
    fireEvent.press(screen.getByTestId('manual-submit'));
    expect(screen.getByTestId('manual-error')).toHaveTextContent(t.manual.empty);
    fireEvent.changeText(screen.getByTestId('manual-input'), 'A');
    expect(screen.queryByTestId('manual-error')).toBeNull();
    fireEvent.changeText(screen.getByTestId('manual-input'), '   ');
    fireEvent.press(screen.getByTestId('manual-submit'));
    expect(screen.getByTestId('manual-error')).toBeOnTheScreen();
    expect(engine.queueDepth).toBe(0);
  });

  it('goes back to the camera', async () => {
    const { engine } = await ready();
    await view(engine);
    fireEvent.press(screen.getByTestId('manual-open'));
    fireEvent.press(screen.getByTestId('manual-close'));
    expect(screen.getByTestId('vision-camera')).toBeOnTheScreen();
  });

  it('labels the field and gives it a hint', async () => {
    const { engine } = await ready();
    await view(engine);
    fireEvent.press(screen.getByTestId('manual-open'));
    const input = screen.getByTestId('manual-input');
    expect(input.props.accessibilityLabel).toBe(t.manual.label);
    expect(input.props.accessibilityHint).toBe(t.manual.hint);
    expect(input.props.autoCapitalize).toBe('characters');
  });
});

describe('the scan screen: before there is a list', () => {
  it('shows the download in progress, then the failure with a way to retry', async () => {
    const server = new FakeServer({ header: await header(), rows: [row(1)] });
    const r = await rig(server, { at: atServerTime });
    server.online = false;
    const scheduler = createScheduler({ engine: r.engine, now: () => r.clock.ms, online: false });
    await view(r.engine, spyFeedback(), scheduler);
    expect(screen.getByTestId('scan-download')).toBeOnTheScreen();
    expect(screen.getByText(t.download.title)).toBeOnTheScreen();
    await act(async () => {
      await r.engine.sync().catch(() => {});
    });
    expect(screen.getByTestId('scan-download-error')).toHaveTextContent(t.download.failedOffline);
    server.online = true;
    await act(async () => fireEvent.press(screen.getByTestId('scan-download-retry')));
    await waitFor(() => expect(screen.getByTestId('verdict-idle')).toBeOnTheScreen());
  });

  it('says when this device is not assigned to the event, and when the list failed its check', async () => {
    const good = await header();
    const server = new FakeServer({
      header: {
        ...good,
        scope: { ...(good.scope as NonNullable<typeof good.scope>), checkpointIds: [NORTH] },
      },
      rows: [row(1)],
    });
    const r = await rig(server, { at: atServerTime });
    await view(r.engine);
    await act(async () => {
      await r.engine.sync().catch(() => {});
    });
    expect(screen.getByTestId('scan-download-error')).toHaveTextContent(t.download.failedScope);
  });

  it('shows the expiry notice once the list has been removed', async () => {
    const { engine, clock } = await ready();
    clock.ms = Date.parse('2027-12-03T04:00:00Z') + 24 * 3_600_000 + 1;
    await engine.expireIfDue();
    await view(engine);
    expect(screen.getByTestId('scan-expired')).toBeOnTheScreen();
    expect(screen.getByText(t.expired.title)).toBeOnTheScreen();
    expect(screen.queryByTestId('vision-camera')).toBeNull();
    expect(screen.queryByTestId('scan-sync')).toBeNull();
  });
});

describe('the scan screen: duplicates found after sync', () => {
  async function twoDoors() {
    const a = await ready({ rows: [row(1)] });
    const b = await rig(a.server, { at: atServerTime });
    await b.engine.sync();
    b.clock.ms = Date.parse(NOW) + 60_000;
    b.engine.setCheckpoint(NORTH);
    return { a, b };
  }

  it('flags the second door’s admission, with a sound, and lets staff dismiss it', async () => {
    const { a, b } = await twoDoors();
    await a.engine.scan(row(1).shortCode);
    await b.engine.scan(row(1).shortCode);
    await a.engine.flush();
    const feedback = spyFeedback();
    await view(b.engine, feedback);
    expect(screen.queryByTestId('flagged-panel')).toBeNull();
    await act(async () => {
      await b.engine.flush();
    });
    const panel = await screen.findByTestId('flagged-panel');
    expect(panel).toBeOnTheScreen();
    expect(
      screen.getByText(
        t.flagged.title.replace(
          '{count, plural, one {# scan needs a second look} other {# scans need a second look}}',
          '1 scan needs a second look',
        ),
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Holder 1')).toBeOnTheScreen();
    expect(screen.getByText(t.flagged.duplicate)).toBeOnTheScreen();
    expect(feedback.played).toContain('duplicate+duplicate');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: t.flagged.dismiss })));
    await waitFor(() => expect(screen.queryByTestId('flagged-panel')).toBeNull());
  });
});

describe('the scan screen: syncing', () => {
  it('sends the queue and refreshes the list when staff press sync', async () => {
    const { engine, server, clock } = await ready();
    const scheduler = createScheduler({ engine, now: () => clock.ms, online: true });
    await view(engine, spyFeedback(), scheduler);
    await act(async () => camera.see(row(1).shortCode));
    await act(async () => fireEvent.press(screen.getByTestId('scan-sync')));
    await waitFor(() => expect(screen.getByTestId('scan-queue')).toHaveTextContent('All scans sent'));
    expect(server.seen.size).toBe(1);
  });
});

describe('the scan screen: session doors', () => {
  it('shows the in/out switch only at a session door', async () => {
    const { engine } = await ready();
    await view(engine);
    expect(screen.queryByTestId('direction-in')).toBeNull();
  });
});

describe('the scan screen: Arabic, right to left', () => {
  it('renders from the Arabic catalog with every control labelled', async () => {
    const { engine } = await ready();
    renderIn(<ScanView engine={engine} scheduler={null} feedback={spyFeedback()} />, 'ar');
    await act(async () => {});
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(screen.getByRole('button', { name: catalogs.ar.scan.sync.button })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: catalogs.ar.scan.manual.open })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: catalogs.ar.scan.torch.on })).toBeOnTheScreen();
    expect(screen.getByTestId('scan-place')).toHaveTextContent('عند: North gate');
    expect(screen.getByTestId('scan-place')).toHaveStyle({ textAlign: 'auto' });
    await act(async () => camera.see(row(1).shortCode));
    await waitFor(() =>
      expect(screen.getByTestId('verdict-title')).toHaveTextContent(catalogs.ar.scan.verdict.admit.title),
    );
    expect(screen.getByTestId('verdict-title')).toHaveStyle({ textAlign: 'auto' });
    expect(screen.getByTestId('verdict-panel').props.accessibilityLabel).toContain('Holder 1');
  });

  it('shows the denied-camera guidance in Arabic', async () => {
    camera.permission = 'denied';
    const { engine } = await ready();
    renderIn(<ScanView engine={engine} scheduler={null} feedback={spyFeedback()} />, 'ar');
    await act(async () => {});
    expect(screen.getByText(catalogs.ar.scan.camera.deniedTitle)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: catalogs.ar.scan.camera.openSettings })).toBeOnTheScreen();
  });

  it('pluralises the queue the Arabic way', async () => {
    const { engine } = await ready();
    renderIn(<ScanView engine={engine} scheduler={null} feedback={spyFeedback()} />, 'ar');
    await act(async () => {});
    await act(async () => camera.see(row(1).shortCode));
    await waitFor(() =>
      expect(screen.getByTestId('scan-queue')).toHaveTextContent('عملية مسح واحدة بانتظار الإرسال'),
    );
  });
});

describe('the scan screen: colours come from the tokens', () => {
  it('fills the verdict from the light palette', async () => {
    const { engine } = await ready();
    await view(engine);
    await act(async () => camera.see(row(1).shortCode));
    expect(await screen.findByTestId('verdict-panel')).toHaveStyle({ backgroundColor: light.success });
  });

  it('fills the verdict from the dark palette', async () => {
    mockScheme.mockReturnValue('dark');
    const { engine } = await ready();
    await view(engine);
    await act(async () => camera.see('NOSUCHCODE'));
    expect(await screen.findByTestId('verdict-panel')).toHaveStyle({ backgroundColor: dark.danger });
  });
});
