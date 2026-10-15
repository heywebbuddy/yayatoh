import { screen } from '@testing-library/react-native';
import Index from '../src/app/index';
import { catalogs } from '../src/i18n';
import { auth, authHandler, tokenPair } from './helpers/auth-mock';
import { enrolLink } from './helpers/fake-door';
import { CHALLENGE, INVITE, portal, portalHandler } from './helpers/portal-mock';
import { type App, buildApp, renderApp, settle, slowStorage } from './helpers/render';
import { resetRouter } from './helpers/router-mock';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

beforeEach(resetRouter);

const target = () => screen.queryByTestId('redirect')?.props.children;

async function enrolled(): Promise<App> {
  const app = buildApp();
  await app.device.enrol(enrolLink());
  await app.device.heartbeat();
  app.device.stopHeartbeat();
  return app;
}

describe('the device gate', () => {
  it('shows the splash while the stored enrolment is read', async () => {
    const keychain = slowStorage();
    const app = buildApp({ storage: keychain.store });
    await renderApp(<Index />, app, { settle: false });
    expect(screen.getByTestId('home-card')).toBeOnTheScreen();
    expect(screen.getByText(catalogs.en.home.title)).toBeOnTheScreen();
    expect(screen.queryByTestId('redirect')).toBeNull();
    await keychain.release();
    await settle();
    expect(target()).toBe('/enrol');
  });

  it('sends a device that is not enrolled to enrolment', async () => {
    await renderApp(<Index />);
    expect(target()).toBe('/enrol');
  });

  it('sends an enrolled device with no place chosen to the picker', async () => {
    await renderApp(<Index />, await enrolled());
    expect(target()).toBe('/select');
  });

  it('sends an enrolled device with a place to the scanner', async () => {
    const app = await enrolled();
    await app.device.selectCheckpoint(null);
    await renderApp(<Index />, app);
    expect(target()).toBe('/scan');
  });

  it('sends a revoked or wiped device back to enrolment', async () => {
    const app = await enrolled();
    app.door.wiping.add((app.device.state.token ?? '') as string);
    await app.device.heartbeat();
    await renderApp(<Index />, app);
    expect(app.device.state.status).toBe('wiped');
    expect(target()).toBe('/enrol');
  });

  it('sends a signed-in organizer to the tools', async () => {
    const app = buildApp();
    await app.core.session.setTokens(tokenPair() as never);
    await renderApp(<Index />, app);
    expect(target()).toBe('/tools');
  });

  it('sends a signed-in exhibitor rep to the tools', async () => {
    const app = buildApp();
    const p = portal();
    app.extra.handler = (request) => portalHandler(p, request);
    await app.portal.verifyCode(INVITE, CHALLENGE, '123456');
    await renderApp(<Index />, app);
    expect(target()).toBe('/tools');
  });

  it('an enrolled door device wins over an organizer account on the same phone', async () => {
    const app = await enrolled();
    app.extra.handler = (request) => authHandler(auth(), request);
    await app.core.session.setTokens(tokenPair() as never);
    await app.device.selectCheckpoint(null);
    await renderApp(<Index />, app);
    expect(target()).toBe('/scan');
  });
});
