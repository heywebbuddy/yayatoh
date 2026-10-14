// Jest setup shared by mobile-core and the two apps (`setupFilesAfterEnv`): the native Sentry SDK
// starts timers and needs a native module, so tests get an inert stand-in. Tests of the Sentry
// wiring pass their own fake to `initSentry` and never reach this one.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  wrap: (component) => component,
}));
