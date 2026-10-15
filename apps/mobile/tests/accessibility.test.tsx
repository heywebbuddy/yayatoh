import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { screen, waitFor } from 'expo-router/testing-library';
import { StyleSheet, TextInput } from 'react-native';
import { onPath, openTab, press, type } from './helpers/actions';
import { cores, renderApp } from './helpers/app';
import { CODE, createFakeServer } from './helpers/fake-server';
import { ar, en } from './helpers/messages';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../src/auth/apple-button', () => require('./helpers/apple-button-mock'));
jest.mock('../src/auth/methods', () => ({ availableMethods: () => ({ apple: true, google: true }) }));
afterEach(() => {
  for (const c of cores.splice(0)) c.queryClient.clear();
});

const MIN_TOUCH = 44;

/** Every control on the screen has a label and a role, and a touch target of at least 44 points. */
function auditControls() {
  const problems: string[] = [];
  let controls = 0;
  for (const role of ['button', 'radio'] as const) {
    for (const node of screen.queryAllByRole(role)) {
      controls += 1;
      const label = node.props.accessibilityLabel ?? node.props['aria-label'];
      const id = node.props.testID ?? String(label);
      if (!label || !String(label).trim()) problems.push(`${role} ${id} has no label`);
      const style = StyleSheet.flatten(
        typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style,
      );
      // The tab bar items get their size from the navigator; screens' own controls say it themselves.
      if (!String(label).includes(', tab, ') && node.props.testID && !((style?.minHeight ?? 0) >= MIN_TOUCH))
        problems.push(`${role} ${id} is smaller than ${MIN_TOUCH} points`);
    }
  }
  for (const input of screen.UNSAFE_queryAllByType(TextInput)) {
    controls += 1;
    if (!input.props.accessibilityLabel) problems.push(`input ${input.props.testID} has no label`);
    if (!((StyleSheet.flatten(input.props.style)?.minHeight ?? 0) >= MIN_TOUCH))
      problems.push(`input ${input.props.testID} is smaller than ${MIN_TOUCH} points`);
  }
  expect(problems).toEqual([]);
  return controls;
}

const headings = () => screen.queryAllByRole('header').length;

describe.each([
  ['English', undefined, en],
  ['Arabic', 'ar', ar],
] as const)('every screen in %s', (_name, locale, messages) => {
  const rtl = locale === 'ar';

  async function audit(expectedScreen: string) {
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: rtl ? 'rtl' : 'ltr' });
    expect(headings()).toBeGreaterThan(0);
    expect(auditControls()).toBeGreaterThan(0);
    expect(screen.getByTestId(expectedScreen)).toBeOnTheScreen();
  }

  it('welcome', async () => {
    const app = await renderApp(locale ? { locale } : {});
    await onPath(app.view, '/welcome');
    await audit('welcome-screen');
    expect(screen.getByRole('header', { name: messages.welcome.title })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: messages.welcome.email })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: messages.welcome.apple })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: messages.welcome.google })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: messages.welcome.password })).toBeOnTheScreen();
  });

  it('email, code, password, two-factor and link-proof', async () => {
    const server = createFakeServer();
    server.config.twoFactor = true;
    const app = await renderApp({ server, ...(locale ? { locale } : {}) });
    await onPath(app.view, '/welcome');
    await press('welcome-email');
    await onPath(app.view, '/email');
    await audit('email-screen');
    expect(screen.getByLabelText(messages.signIn.email.label)).toBeOnTheScreen();
    type('email-input', 'ada@example.test');
    await press('email-submit');
    await onPath(app.view, '/code');
    await audit('code-screen');
    expect(screen.getByLabelText(messages.signIn.code.label)).toBeOnTheScreen();
    type('code-input', CODE);
    await onPath(app.view, '/two-factor');
    await audit('two-factor-screen');
    expect(screen.getByLabelText(messages.signIn.twoFactor.label)).toBeOnTheScreen();
  });

  it('password', async () => {
    const app = await renderApp(locale ? { locale } : {});
    await onPath(app.view, '/welcome');
    await press('welcome-password');
    await onPath(app.view, '/password');
    await audit('password-screen');
    expect(screen.getByLabelText(messages.signIn.password.label)).toBeOnTheScreen();
  });

  it('link-proof', async () => {
    const server = createFakeServer();
    server.config.providerEmailExists = true;
    const app = await renderApp({ server, ...(locale ? { locale } : {}) });
    await onPath(app.view, '/welcome');
    await press('welcome-google');
    await onPath(app.view, '/link-proof');
    await audit('link-proof-screen');
  });

  it('account, language, deletion and the deleted page', async () => {
    const app = await renderApp({ signedIn: true, ...(locale ? { locale } : {}) });
    await onPath(app.view, '/tickets');
    await audit('tickets-screen');
    await openTab(messages.account.tabs.account);
    await onPath(app.view, '/account');
    await audit('account-screen');
    expect(screen.getByRole('button', { name: messages.account.signOut.button })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: messages.account.signOutEverywhere.button })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: messages.account.delete.entry })).toBeOnTheScreen();
    expect(screen.getAllByRole('radio')).toHaveLength(3);

    await press('account-language');
    await onPath(app.view, '/account/language');
    await audit('language-screen');
    expect(screen.getAllByRole('radio')).toHaveLength(14);

    app.view.unmount();
  });

  it('deletion steps', async () => {
    const app = await renderApp({ signedIn: true, url: '/account/delete', ...(locale ? { locale } : {}) });
    await onPath(app.view, '/account/delete');
    await audit('delete-account-screen');
    expect(screen.getByRole('button', { name: messages.account.delete.continue })).toBeOnTheScreen();
    await press('delete-continue');
    await waitFor(() => expect(screen.getByTestId('delete-proof')).toBeOnTheScreen());
    await audit('delete-account-screen');
    expect(screen.getByLabelText(messages.account.delete.emailLabel)).toBeOnTheScreen();
  });

  it('the deleted page', async () => {
    const app = await renderApp({ url: '/account/deleted', ...(locale ? { locale } : {}) });
    await onPath(app.view, '/account/deleted');
    await audit('account-deleted-screen');
    expect(screen.getByText(messages.account.deleted.title)).toBeOnTheScreen();
  });
});

describe('Arabic is really Arabic', () => {
  it('uses its own strings, not English', () => {
    expect(ar.welcome.title).not.toBe(en.welcome.title);
    expect(ar.account.delete.submit).not.toBe(en.account.delete.submit);
  });
});

describe('logical layout', () => {
  /** Source files of the screens and their helpers. */
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it('has no left/right styles in the sign-in and account screens: only start/end, so Arabic mirrors', () => {
    const roots = [
      join(__dirname, '../src/auth'),
      join(__dirname, '../src/app/(auth)'),
      join(__dirname, '../src/app/(tabs)'),
      join(__dirname, '../src/app/account'),
    ];
    const offenders = roots
      .flatMap(files)
      .filter((f) =>
        /\b(?:margin|padding|border)(?:Left|Right)\w*\s*:|\b(?:left|right)\s*:|textAlign:\s*'(?:left|right)'|flexDirection:\s*'row-reverse'/.test(
          readFileSync(f, 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it('colours come from the design tokens: no hex or rgb literal in the screens', () => {
    const offenders = [join(__dirname, '../src/auth'), join(__dirname, '../src/app')]
      .flatMap(files)
      .filter((f) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
