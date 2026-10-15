import { act, renderHook, screen, waitFor } from 'expo-router/testing-library';
import { RESEND_AFTER_SECONDS, useCountdown } from '../src/auth/countdown';
import { onPath, press, type } from './helpers/actions';
import { cores, renderApp } from './helpers/app';
import { createFakeServer } from './helpers/fake-server';
import { en } from './helpers/messages';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../src/auth/apple-button', () => require('./helpers/apple-button-mock'));
// A one-second cooldown instead of thirty, so the resend can be pressed in real time.
jest.mock('../src/auth/countdown', () => ({
  ...jest.requireActual('../src/auth/countdown'),
  RESEND_AFTER_SECONDS: 1,
}));
afterEach(() => {
  for (const c of cores.splice(0)) c.queryClient.clear();
});

describe('useCountdown', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('counts whole seconds down to zero and stops there', () => {
    const { result } = renderHook(() => useCountdown(3));
    expect(result.current.remaining).toBe(3);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.remaining).toBe(2);
    // The timer is re-armed after each render, so tick once per second.
    for (let i = 0; i < 5; i++)
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    expect(result.current.remaining).toBe(0);
  });

  it('starts again from a new number and rounds a fraction up', () => {
    const { result } = renderHook(() => useCountdown(0));
    act(() => result.current.start(2.2));
    expect(result.current.remaining).toBe(3);
    act(() => result.current.start(-5));
    expect(result.current.remaining).toBe(0);
  });

  it('the default wait after sending a code is thirty seconds', () => {
    expect(jest.requireActual('../src/auth/countdown').RESEND_AFTER_SECONDS).toBe(30);
    expect(RESEND_AFTER_SECONDS).toBe(1);
  });
});

describe('resend on the code screen', () => {
  async function toCodeScreen(server = createFakeServer()) {
    const app = await renderApp({ server });
    await onPath(app.view, '/welcome');
    await press('welcome-email');
    type('email-input', 'ada@example.test');
    await press('email-submit');
    await onPath(app.view, '/code');
    return app;
  }

  it('is held back for the cooldown, then sends a new code and says so', async () => {
    const app = await toCodeScreen();
    const resend = () => screen.getByTestId('code-resend');
    expect(resend().props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('Send a new code in 1 second')).toBeOnTheScreen();
    await waitFor(() => expect(resend().props.accessibilityState.disabled).toBe(false), { timeout: 3000 });
    expect(screen.getByLabelText(en.signIn.code.resend)).toBeOnTheScreen();
    await press('code-resend');
    await waitFor(() => expect(screen.getByText(en.signIn.code.resent)).toBeOnTheScreen());
    expect(app.server.to('POST', '/v1/auth/email-code')).toHaveLength(2);
    expect(resend().props.accessibilityState.disabled).toBe(true);
  });

  it('shows the server wait when a resend is rate-limited', async () => {
    const server = createFakeServer();
    const app = await toCodeScreen(server);
    await waitFor(
      () => expect(screen.getByTestId('code-resend').props.accessibilityState.disabled).toBe(false),
      {
        timeout: 3000,
      },
    );
    server.config.emailCodeRateLimit = 120;
    await press('code-resend');
    await waitFor(() => expect(screen.getByTestId('code-resend-problem')).toBeOnTheScreen());
    expect(screen.getByText('Too many attempts. Try again in 2 minutes.')).toBeOnTheScreen();
    expect(screen.getByTestId('code-resend').props.accessibilityState.disabled).toBe(true);
    expect(app.server.to('POST', '/v1/auth/email-code')).toHaveLength(2);
  });
});
