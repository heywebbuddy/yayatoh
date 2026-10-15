import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import ExhibitorSignIn from '../src/app/sign-in/exhibitor';
import { catalogs } from '../src/i18n';
import { problem } from './helpers/fake-door';
import { CHALLENGE, INVITE, inviteLink, type Portal, portal, portalHandler } from './helpers/portal-mock';
import { type App, buildApp, missingMessages, renderApp, settle, shownTexts } from './helpers/render';
import { resetRouter, router } from './helpers/router-mock';
import { shared } from './helpers/shared';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const en = catalogs.en;
const x = en.exhibitor;
beforeEach(resetRouter);

function appWith(p: Portal, locale?: string): App {
  const app = buildApp(locale ? { locale } : {});
  app.extra.handler = (request) => portalHandler(p, request);
  return app;
}
const type = (id: string, value: string) => fireEvent.changeText(screen.getByTestId(id), value);
const press = async (id: string) => {
  fireEvent.press(screen.getByTestId(id));
  await settle();
  await settle();
};
async function askForCode(link = inviteLink) {
  type('exhibitor-invite', link);
  await press('exhibitor-send');
}

describe('exhibitor sign-in: the invitation', () => {
  it('asks for the invitation link', async () => {
    await renderApp(<ExhibitorSignIn />, appWith(portal()));
    expect(screen.getByRole('header', { name: x.title })).toBeOnTheScreen();
    expect(screen.getByText(x.intro)).toBeOnTheScreen();
    expect(screen.getByLabelText(x.inviteLabel)).toBeOnTheScreen();
    expect(missingMessages(shownTexts())).toEqual([]);
  });

  it('refuses something that is not an invitation link, without a request', async () => {
    const p = portal();
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode('https://example.org/hello');
    expect(screen.getByTestId('exhibitor-invite-error')).toHaveTextContent(x.errors.inviteInvalid);
    expect(p.requests).toHaveLength(0);
  });

  it('emails a code for the invitation, from the link or the bare token', async () => {
    const p = portal();
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode(INVITE);
    expect(p.requests[0]).toMatchObject({
      path: expect.stringContaining('/portal/auth/code'),
      body: { inviteToken: INVITE },
    });
    expect(screen.getByText(x.codeIntro)).toBeOnTheScreen();
  });

  it('goes on with the code that was sent a moment ago (the server’s cooldown)', async () => {
    const p = portal({
      code: () =>
        new Response(
          JSON.stringify({ status: 'cooldown', challengeId: CHALLENGE, resendAt: new Date().toISOString() }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    });
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode();
    expect(screen.getByLabelText(x.codeLabel)).toBeOnTheScreen();
  });

  it('says an invitation that cannot be used cannot be used', async () => {
    const p = portal({ code: () => problem(403, 'forbidden') });
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode();
    expect(screen.getByTestId('exhibitor-error')).toHaveTextContent(x.errors.invalidInvite);
    expect(screen.getByLabelText(x.inviteLabel)).toBeOnTheScreen();
  });

  it('tells the person how long to wait when the server limits requests', async () => {
    const p = portal({
      code: () =>
        new Response(JSON.stringify({ code: 'rate_limited', details: { retryAfter: 600 } }), {
          status: 429,
          headers: { 'content-type': 'application/problem+json', 'retry-after': '600' },
        }),
    });
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode();
    expect(screen.getByTestId('exhibitor-error')).toHaveTextContent(/10 minutes/);
  });

  it('says when the server cannot be reached', async () => {
    const app = appWith(portal());
    await renderApp(<ExhibitorSignIn />, app);
    app.door.failNetwork = true;
    await askForCode();
    expect(screen.getByTestId('exhibitor-error')).toHaveTextContent(shared('en').signIn.unavailable);
  });
});

describe('exhibitor sign-in: the code', () => {
  it('opens a portal session with the right code and opens the app', async () => {
    const p = portal();
    const app = appWith(p);
    await renderApp(<ExhibitorSignIn />, app);
    await askForCode();
    type('exhibitor-code', '123 456');
    await press('exhibitor-verify');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(app.portal.store.state.status).toBe('signedIn');
    expect(p.requests[1]?.body).toMatchObject({
      grantType: 'code',
      inviteToken: INVITE,
      challengeId: CHALLENGE,
      code: '123 456',
    });
    // The rep's tokens are in secure storage under the portal's own prefix, apart from the account's.
    expect(app.storage.data.get('portal.yayatoh.session.v1')).toContain('yyp_refresh1');
    expect(app.storage.data.has('yayatoh.session.v1')).toBe(false);
  });

  it('wants six digits', async () => {
    const p = portal();
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode();
    for (const bad of ['', '12345', 'abcdef', '1234567']) {
      type('exhibitor-code', bad);
      await press('exhibitor-verify');
      expect(screen.getByTestId('exhibitor-code-error')).toHaveTextContent(x.errors.codeInvalid);
    }
    expect(p.requests).toHaveLength(1);
  });

  it('says a wrong code is wrong, and how many tries are left', async () => {
    await renderApp(<ExhibitorSignIn />, appWith(portal()));
    await askForCode();
    type('exhibitor-code', '000000');
    await press('exhibitor-verify');
    expect(screen.getByTestId('exhibitor-error')).toHaveTextContent(
      /That code is not right\. 4 tries left\./,
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says it without a count when the server gave none, and with the singular for one try', async () => {
    let left: number | null = 1;
    const p = portal({
      token: () =>
        problem(401, 'unauthenticated', {
          reason: 'wrong_code',
          ...(left === null ? {} : { attemptsLeft: left }),
        }),
    });
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode();
    type('exhibitor-code', '000000');
    await press('exhibitor-verify');
    expect(screen.getByTestId('exhibitor-error')).toHaveTextContent(/1 try left\./);
    left = null;
    await press('exhibitor-verify');
    expect(screen.getByTestId('exhibitor-error')).toHaveTextContent(new RegExp(x.errors.wrongCode));
  });

  it('starts over when the code is locked, expired or already used', async () => {
    const p = portal({ token: () => problem(401, 'unauthenticated', { reason: 'code_locked' }) });
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode();
    type('exhibitor-code', '123456');
    await press('exhibitor-verify');
    expect(screen.getByTestId('exhibitor-error')).toHaveTextContent(x.errors.codeRejected);
    expect(screen.getByLabelText(x.inviteLabel)).toBeOnTheScreen();
  });

  it('starts over when the invitation stopped working meanwhile', async () => {
    const p = portal({ token: () => problem(403, 'forbidden') });
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode();
    type('exhibitor-code', '123456');
    await press('exhibitor-verify');
    expect(screen.getByTestId('exhibitor-error')).toHaveTextContent(x.errors.invalidInvite);
    expect(screen.getByLabelText(x.inviteLabel)).toBeOnTheScreen();
  });

  it('asks for another code', async () => {
    const p = portal();
    await renderApp(<ExhibitorSignIn />, appWith(p));
    await askForCode();
    await press('exhibitor-resend');
    expect(p.requests.filter((r) => r.path.endsWith('/portal/auth/code'))).toHaveLength(2);
    expect(screen.getByLabelText(x.codeLabel)).toBeOnTheScreen();
  });

  it('goes back', async () => {
    await renderApp(<ExhibitorSignIn />, appWith(portal()));
    await press('exhibitor-back');
    expect(router.back).toHaveBeenCalled();
  });
});

describe('accessibility and right to left', () => {
  it('labels every control', async () => {
    await renderApp(<ExhibitorSignIn />, appWith(portal()));
    await askForCode();
    for (const b of screen.getAllByRole('button')) expect(b.props.accessibilityLabel).toBeTruthy();
    expect(screen.getByTestId('exhibitor-code').props.accessibilityLabel).toBe(x.codeLabel);
  });

  it('renders both steps and the plural error in Arabic, right to left', async () => {
    await renderApp(<ExhibitorSignIn />, appWith(portal(), 'ar'));
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(screen.getByRole('header', { name: catalogs.ar.exhibitor.title })).toBeOnTheScreen();
    await askForCode();
    expect(screen.getByText(catalogs.ar.exhibitor.codeIntro)).toBeOnTheScreen();
    type('exhibitor-code', '000000');
    await press('exhibitor-verify');
    expect(screen.getByTestId('exhibitor-error')).toHaveTextContent(/تبقّت 4 محاولات/);
    expect(missingMessages(shownTexts())).toEqual([]);
  });
});
