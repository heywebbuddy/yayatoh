import { act, render, waitFor } from '@testing-library/react-native';
import { memoryKeyValueStore } from '@yayatoh/mobile-core';
import { Text } from 'react-native';
import { DB_KEY_NAME, DB_NAME } from '../../src/scan/db';
import { currentScanRuntime } from '../../src/scan/runtime';
import { EVENT_ID, FakeServer, fakeSqlite, header, NORTH, row } from './harness';

const KEY = 'ef'.repeat(32);
const mockSqlite = fakeSqlite();
const mockStorage = memoryKeyValueStore({ [DB_KEY_NAME]: KEY });
let mockServer: FakeServer;
let mockOffline = false;

const mockDevice = {
  status: 'enrolled' as 'enrolled' | 'unenrolled',
  eventId: EVENT_ID as string | null,
  checkpointId: null as string | null,
  api: {},
  wipe: undefined as undefined | (() => void | Promise<void>),
  onWipe: jest.fn((cb: () => void | Promise<void>) => {
    mockDevice.wipe = cb;
    return () => {
      mockDevice.wipe = undefined;
    };
  }),
  depth: undefined as undefined | (() => number | Promise<number>),
  setQueueDepthSource: jest.fn((fn: () => number | Promise<number>) => {
    mockDevice.depth = fn;
    return () => {
      mockDevice.depth = undefined;
    };
  }),
  syncRequested: undefined as undefined | (() => void | Promise<void>),
  onSyncRequested: jest.fn((cb: () => void | Promise<void>) => {
    mockDevice.syncRequested = cb;
    return () => {
      mockDevice.syncRequested = undefined;
    };
  }),
};

jest.mock('../../src/device', () => ({ useDevice: () => mockDevice }));
jest.mock('@yayatoh/mobile-core', () => ({
  ...jest.requireActual('@yayatoh/mobile-core'),
  useCore: () => ({ storage: mockStorage }),
  useIsOffline: () => mockOffline,
  reportError: jest.fn(),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (name: string) => mockSqlite.module.openDatabaseAsync(name),
  deleteDatabaseAsync: (name: string) => mockSqlite.module.deleteDatabaseAsync(name),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 17 + 5) % 256),
}));
jest.mock('../../src/scan/api', () => ({
  ...jest.requireActual('../../src/scan/api'),
  sdkScanApi: () => mockServer.api(),
}));

import { ScanProvider, useScanRuntime } from '../../src/scan/provider';

function Probe() {
  const runtime = useScanRuntime();
  return <Text testID="probe">{runtime ? `open:${runtime.engine.status.phase}` : 'closed'}</Text>;
}

beforeEach(async () => {
  mockServer = new FakeServer({ header: await header(), rows: [row(1), row(2)] });
  mockOffline = false;
  mockDevice.status = 'enrolled';
  mockDevice.eventId = EVENT_ID;
  mockDevice.checkpointId = null;
  mockDevice.wipe = undefined;
  mockDevice.depth = undefined;
  mockDevice.syncRequested = undefined;
  mockDevice.onWipe.mockClear();
  mockDevice.setQueueDepthSource.mockClear();
  mockDevice.onSyncRequested.mockClear();
  mockStorage.data.set(DB_KEY_NAME, KEY);
});

afterEach(async () => {
  const open = currentScanRuntime();
  open?.scheduler.stop();
  await open?.close();
});

describe('ScanProvider', () => {
  it('opens nothing for a device that is not enrolled, but still registers the wipe', async () => {
    mockDevice.status = 'unenrolled';
    mockDevice.eventId = null;
    const ui = render(
      <ScanProvider>
        <Probe />
      </ScanProvider>,
    );
    expect(ui.getByTestId('probe')).toHaveTextContent('closed');
    expect(mockDevice.onWipe).toHaveBeenCalledTimes(1);
    expect(mockSqlite.opened).not.toContain(DB_NAME);
    ui.unmount();
  });

  it('opens the encrypted database for the enrolled event and downloads the list in the background', async () => {
    const ui = render(
      <ScanProvider>
        <Probe />
      </ScanProvider>,
    );
    await waitFor(() => expect(ui.getByTestId('probe')).toHaveTextContent(/^open:/));
    expect(mockSqlite.statements[0]).toBe(`PRAGMA key = "x'${KEY}'";`);
    await waitFor(() => expect(ui.getByTestId('probe')).toHaveTextContent('open:ready'));
    expect(currentScanRuntime()?.engine.status.ticketCount).toBe(2);
    ui.unmount();
  });

  it('feeds the heartbeat its queue depth, passes on the checkpoint and answers a sync request', async () => {
    mockDevice.checkpointId = NORTH;
    const ui = render(
      <ScanProvider>
        <Probe />
      </ScanProvider>,
    );
    await waitFor(() => expect(ui.getByTestId('probe')).toHaveTextContent('open:ready'));
    const engine = currentScanRuntime()?.engine;
    expect(engine?.checkpoint?.id).toBe(NORTH);
    expect(await mockDevice.depth?.()).toBe(0);
    await act(async () => {
      await engine?.scan(row(1).shortCode);
    });
    expect(await mockDevice.depth?.()).toBe(1);
    mockServer.rows.push(row(3));
    await act(async () => {
      await mockDevice.syncRequested?.();
    });
    expect(engine?.queueDepth).toBe(0);
    expect(mockServer.seen.size).toBe(1);
    expect(engine?.status.ticketCount).toBe(3);
    ui.unmount();
    expect(mockDevice.depth).toBeUndefined();
    expect(mockDevice.syncRequested).toBeUndefined();
  });

  it('deletes the database and its key when the device layer wipes, with the scan screen never opened', async () => {
    const ui = render(
      <ScanProvider>
        <Probe />
      </ScanProvider>,
    );
    await waitFor(() => expect(ui.getByTestId('probe')).toHaveTextContent('open:ready'));
    await act(async () => {
      await mockDevice.wipe?.();
    });
    expect(mockSqlite.exists(DB_NAME)).toBe(false);
    expect(mockStorage.data.has(DB_KEY_NAME)).toBe(false);
    ui.unmount();
    expect(mockDevice.wipe).toBeUndefined();
  });

  it('holds off the network while the phone is offline and catches up when it returns', async () => {
    const ui = render(
      <ScanProvider>
        <Probe />
      </ScanProvider>,
    );
    await waitFor(() => expect(ui.getByTestId('probe')).toHaveTextContent('open:ready'));
    const engine = currentScanRuntime()?.engine;
    mockOffline = true;
    ui.rerender(
      <ScanProvider>
        <Probe />
      </ScanProvider>,
    );
    mockServer.online = false;
    await act(async () => {
      await engine?.scan(row(2).shortCode);
    });
    expect(engine?.queueDepth).toBe(1);
    mockServer.online = true;
    mockOffline = false;
    ui.rerender(
      <ScanProvider>
        <Probe />
      </ScanProvider>,
    );
    await waitFor(() => expect(engine?.queueDepth).toBe(0));
    ui.unmount();
  });
});
