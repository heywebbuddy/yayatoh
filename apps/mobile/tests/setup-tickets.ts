// Native modules the Tickets screens reach through `src/tickets/services.tsx`. The screens take
// their services from a provider in tests; these stand-ins only let the default adapter be imported.
jest.mock('expo-brightness', () => ({
  getBrightnessAsync: jest.fn(async () => 0.4),
  setBrightnessAsync: jest.fn(async () => {}),
  restoreSystemBrightnessAsync: jest.fn(async () => {}),
}));
jest.mock('expo-calendar', () => ({
  requestCalendarPermissions: jest.fn(async () => ({ granted: true })),
  getDefaultCalendarSync: jest.fn(() => ({ addEventWithForm: jest.fn(async () => ({ action: 'saved' })) })),
  getCalendars: jest.fn(async () => []),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
// `expo-crypto` has no native module under Jest; the idempotency keys only need a UUID.
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  randomUUID: () => require('node:crypto').randomUUID(),
}));
