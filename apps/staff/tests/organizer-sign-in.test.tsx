import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import OrganizerSignIn from '../src/app/sign-in/organizer';
import { catalogs } from '../src/i18n';
import { auth, authHandler, tokenPair } from './helpers/auth-mock';
import { json, problem } from './helpers/fake-door';
import { type App, buildApp, missingMessages, renderApp, settle, shownTexts } from './helpers/render';
import { resetRouter, router } from './helpers/router-mock';
import { shared } from './helpers/shared';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const en = catalogs.en;
const core = en.organizer;
beforeEach(resetRouter);

function appWith(a: ReturnType<typeof auth>, locale?: string): App {
  const app = buildApp(locale ? { locale } : {});
  app.extra.handler = (request) => authHandler(a, request);
  return app;
}

const type = (id: string, value: string) => fireEvent.changeText(screen.getByTestId(id), value);
const press = async (id: string) => {
  fireEvent.press(screen.getByTestId(id));
  await settle();
  await settle();
};
async function signInWithPassword() {
  type('organizer-email', 'omar@yayatoh.test');
  type('organizer-password', 'correct horse');
  await press('organizer-continue');
}

describe('organizer sign-in', () => {
  it('asks for the account email and password', async () => {
    await renderApp(<OrganizerSignIn />, appWith(auth()));
    expect(screen.getByRole('header', { name: core.title })).toBeOnTheScreen();
    expect(screen.getByLabelText(core.email)).toBeOnTheScreen();
    expect(screen.getByLabelText(core.password)).toBeOnTheScreen();
    expect(screen.getByTestId('organizer-password').props.secureTextEntry).toBe(true);
    expect(missingMessages(shownTexts())).toEqual([]);
  });

  it('checks the email address before asking the server', async () => {
    const a = auth();
    await renderApp(<OrganizerSignIn />, appWith(a));
    type('organizer-email', 'not an email');
    type('organizer-password', 'x');
    await press('organizer-continue');
    expect(screen.getByTestId('organizer-email-error')).toHaveTextContent(core.errors.emailInvalid);
    expect(a.requests).toHaveLength(0);
  });

  it('asks for the password', async () => {
    const a = auth();
    await renderApp(<OrganizerSignIn />, appWith(a));
    type('organizer-email', 'omar@yayatoh.test');
    await press('organizer-continue');
    expect(screen.getByTestId('organizer-password-error')).toHaveTextContent(core.errors.passwordRequired);
    expect(a.requests).toHaveLength(0);
  });

  it('asks for the authenticator code, then signs in and opens the app', async () => {
    const a = auth();
    const app = appWith(a);
    await renderApp(<OrganizerSignIn />, app);
    await signInWithPassword();
    expect(screen.getByText(core.codeIntro)).toBeOnTheScreen();
    expect(app.core.session.state.status).not.toBe('signedIn');
    type('organizer-code', '123456');
    await press('organizer-verify');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(app.core.session.state.status).toBe('signedIn');
    expect(a.requests.map((r) => r.body.grantType)).toEqual(['password', 'two_factor']);
    expect(a.requests[1]?.body).toMatchObject({ challenge: 'challenge-1', code: '123456' });
  });

  it('asks for the code when it is left empty', async () => {
    await renderApp(<OrganizerSignIn />, appWith(auth()));
    await signInWithPassword();
    await press('organizer-verify');
    expect(screen.getByTestId('organizer-code-error')).toHaveTextContent(core.errors.codeRequired);
  });

  it('says a wrong code is wrong and lets the person try again', async () => {
    const app = appWith(auth());
    await renderApp(<OrganizerSignIn />, app);
    await signInWithPassword();
    type('organizer-code', '000000');
    await press('organizer-verify');
    expect(screen.getByTestId('organizer-error')).toHaveTextContent(shared('en').signIn.failed.invalid_code);
    expect(router.replace).not.toHaveBeenCalled();
    type('organizer-code', '123456');
    await press('organizer-verify');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('says so for a wrong email or password', async () => {
    const a = auth({ password: () => problem(401, 'unauthenticated', { reason: 'invalid_credentials' }) });
    await renderApp(<OrganizerSignIn />, appWith(a));
    await signInWithPassword();
    expect(screen.getByTestId('organizer-error')).toHaveTextContent(
      shared('en').signIn.failed.invalid_credentials,
    );
    expect(screen.queryByLabelText(core.code)).toBeNull();
  });

  it('refuses an account without two-step verification, and signs it out again', async () => {
    const a = auth({ password: () => json(200, tokenPair(7)) });
    const app = appWith(a);
    await renderApp(<OrganizerSignIn />, app);
    await signInWithPassword();
    expect(screen.getByTestId('organizer-error')).toHaveTextContent(core.twoFactorRequired);
    expect(router.replace).not.toHaveBeenCalled();
    expect(app.core.session.state).toMatchObject({ status: 'signedOut' });
    expect(a.revoked).toEqual(['refresh-7']);
    expect(app.storage.data.has('yayatoh.session.v1')).toBe(false);
  });

  it('goes back to the password step when the challenge ran out', async () => {
    const a = auth({ twoFactor: () => problem(401, 'unauthenticated', { reason: 'invalid_challenge' }) });
    await renderApp(<OrganizerSignIn />, appWith(a));
    await signInWithPassword();
    type('organizer-code', '123456');
    await press('organizer-verify');
    expect(screen.getByTestId('organizer-error')).toHaveTextContent(
      shared('en').signIn.failed.invalid_challenge,
    );
    expect(screen.getByLabelText(core.password)).toBeOnTheScreen();
  });

  it('tells the person how long to wait when the server limits attempts', async () => {
    const a = auth({
      password: () =>
        new Response(JSON.stringify({ code: 'rate_limited', details: { retryAfter: 120 } }), {
          status: 429,
          headers: { 'content-type': 'application/problem+json', 'retry-after': '120' },
        }),
    });
    await renderApp(<OrganizerSignIn />, appWith(a));
    await signInWithPassword();
    expect(screen.getByTestId('organizer-error')).toHaveTextContent(/2 minutes/);
  });

  it('says when the server cannot be reached', async () => {
    const app = appWith(auth());
    await renderApp(<OrganizerSignIn />, app);
    app.door.failNetwork = true;
    await signInWithPassword();
    expect(screen.getByTestId('organizer-error')).toHaveTextContent(shared('en').signIn.unavailable);
  });

  it('can cancel the code step and start again', async () => {
    await renderApp(<OrganizerSignIn />, appWith(auth()));
    await signInWithPassword();
    await press('organizer-cancel');
    expect(screen.getByLabelText(core.email)).toBeOnTheScreen();
    expect(screen.queryByTestId('organizer-error')).toBeNull();
  });

  it('goes back with the back button', async () => {
    await renderApp(<OrganizerSignIn />, appWith(auth()));
    await press('organizer-back');
    expect(router.back).toHaveBeenCalled();
  });

  it('never shows a message key in place of a message', async () => {
    await renderApp(<OrganizerSignIn />, appWith(auth()));
    await signInWithPassword();
    expect(missingMessages(shownTexts())).toEqual([]);
  });
});

describe('accessibility and right to left', () => {
  it('labels every field and button, at least 44 points tall', async () => {
    await renderApp(<OrganizerSignIn />, appWith(auth()));
    for (const b of screen.getAllByRole('button')) expect(b.props.accessibilityLabel).toBeTruthy();
    for (const id of ['organizer-email', 'organizer-password'])
      expect(screen.getByTestId(id).props.accessibilityLabel).toBeTruthy();
    expect(
      Object.assign({}, ...[screen.getByTestId('organizer-email').props.style].flat(2)).minHeight,
    ).toBeGreaterThanOrEqual(44);
  });

  it('renders both steps in Arabic, right to left', async () => {
    await renderApp(<OrganizerSignIn />, appWith(auth(), 'ar'));
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(screen.getByRole('header', { name: catalogs.ar.organizer.title })).toBeOnTheScreen();
    expect(screen.getByLabelText(catalogs.ar.organizer.email)).toBeOnTheScreen();
    await signInWithPassword();
    expect(screen.getByText(catalogs.ar.organizer.codeIntro)).toBeOnTheScreen();
    expect(screen.getByLabelText(catalogs.ar.organizer.code)).toBeOnTheScreen();
    expect(missingMessages(shownTexts())).toEqual([]);
  });

  it('shows a shared error in Arabic too', async () => {
    const a = auth({ password: () => problem(401, 'unauthenticated', { reason: 'invalid_credentials' }) });
    await renderApp(<OrganizerSignIn />, appWith(a, 'ar'));
    await signInWithPassword();
    expect(screen.getByTestId('organizer-error')).toHaveTextContent(
      shared('ar').signIn.failed.invalid_credentials,
    );
    expect(shared('ar').signIn.failed.invalid_credentials).not.toBe(
      shared('en').signIn.failed.invalid_credentials,
    );
  });
});
