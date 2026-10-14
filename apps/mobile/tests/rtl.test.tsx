import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { catalogs } from '../src/i18n';
import { ClaimScreen } from '../src/tickets/screens/claim';
import { RefundScreen } from '../src/tickets/screens/refund';
import { TicketDetailScreen } from '../src/tickets/screens/ticket-detail';
import { TicketLinkScreen } from '../src/tickets/screens/ticket-link';
import { TicketsListScreen } from '../src/tickets/screens/tickets-list';
import { TransferScreen } from '../src/tickets/screens/transfer';
import { expectAccessibleControls } from './helpers/a11y';
import { setOnline, setup, teardown } from './helpers/app';
import { claimDetails, IDS, order, page, summary, ticket } from './helpers/fixtures';
import { resetRouter } from './helpers/router-mock';
import { json } from './helpers/server';

jest.mock('expo-router', () => require('./helpers/router-mock').routerMock);

const apps: ReturnType<typeof setup>[] = [];
function mount(locale: 'en' | 'ar' | 'ja' | 'ru' = 'ar') {
  const app = setup({ locale });
  apps.push(app);
  app.server.on('GET /v1/me/tickets', (c) =>
    c.query.get('when') === 'past'
      ? page([])
      : page([summary(), summary({ id: IDS.t2, pendingTransfer: true, seatLabel: 'A1' })]),
  );
  app.server.on('GET /v1/me/tickets/:id', (_c, p) => ticket({ id: p.id as string, seatLabel: 'A1' }));
  app.server.on('GET /v1/me/orders/:id', () => order());
  app.server.on('GET /v1/claims/:token', () => claimDetails());
  app.server.on('GET /v1/me/ticket-links/:token', () => json(200, { ticketIds: [IDS.t1, IDS.t2] }));
  return app;
}
beforeEach(() => {
  resetRouter();
  setOnline(true);
});
afterEach(() => {
  setOnline(true);
  teardown(apps);
});

const ar = catalogs.ar.tickets;
const en = catalogs.en.tickets;

describe('Arabic, right to left', () => {
  it('My tickets: the Arabic strings, a right-to-left root, and every control named', async () => {
    const app = mount();
    await app.ready;
    app.view(<TicketsListScreen />);
    await screen.findByTestId(`ticket-card-${IDS.t1}`);
    expect(screen.getByText(ar.list.title)).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: ar.list.upcoming })).toBeOnTheScreen();
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(ar.list.title).not.toBe(en.list.title);
    // The card label is read in Arabic, with the Arabic words around the event's own text.
    expect(screen.getByTestId(`ticket-card-${IDS.t1}`).props.accessibilityLabel).toContain('Summer Night');
    expect(screen.getByTestId(`ticket-card-${IDS.t1}`).props.accessibilityLabel).toMatch(/صاحب التذكرة/);
    expect(screen.getByText(ar.list.transferPending)).toBeOnTheScreen();
    expectAccessibleControls();
  });

  it('My tickets, empty: the Arabic empty state and its link to Discover', async () => {
    const app = mount();
    app.server.on('GET /v1/me/tickets', () => page([]));
    await app.ready;
    app.view(<TicketsListScreen />);
    expect(await screen.findByText(ar.list.emptyUpcomingTitle)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: ar.list.findEvents })).toBeOnTheScreen();
    expectAccessibleControls();
  });

  it('Ticket detail: spoken QR description, spelled-out code, facts and actions in Arabic', async () => {
    const app = mount();
    await app.ready;
    app.view(<TicketDetailScreen id={IDS.t1} />);
    await screen.findByTestId('qr-card');
    expect(
      screen.getByRole('image', { name: ar.detail.qrLabel.replace('{event}', 'Summer Night') }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('short-code')).toHaveAccessibleName(
      ar.detail.shortCodeLabel.replace('{code}', 'A B 1 2 C D'),
    );
    expect(screen.getByRole('button', { name: ar.detail.calendar })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: ar.detail.directions })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: ar.detail.transfer })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: ar.detail.refund })).toBeOnTheScreen();
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expectAccessibleControls();
  });

  it('Transfer, with validation errors in Arabic', async () => {
    const app = mount();
    await app.ready;
    app.view(<TransferScreen id={IDS.t1} />);
    await screen.findByTestId('transfer-form');
    fireEvent.press(screen.getByRole('button', { name: ar.transfer.review }));
    expect(screen.getByText(ar.transfer.nameRequired)).toBeOnTheScreen();
    expect(screen.getByText(ar.transfer.emailInvalid)).toBeOnTheScreen();
    expect(screen.getByTestId('to-name')).toHaveAccessibleName(ar.transfer.toName);
    expectAccessibleControls();
  });

  it('Refund request: policy and form in Arabic, every switch named', async () => {
    const app = mount();
    await app.ready;
    app.view(<RefundScreen id={IDS.t1} />);
    await screen.findByTestId('refund-form');
    expect(screen.getByText(ar.refund.policy)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: ar.refund.submit })).toBeOnTheScreen();
    expect(screen.getAllByRole('switch').length).toBe(2);
    expectAccessibleControls();
  });

  it('Claim: the offer and the claim button in Arabic', async () => {
    const app = mount();
    await app.ready;
    app.view(<ClaimScreen token="claimtoken-abcdef123456" />);
    await screen.findByTestId('claim-offer');
    expect(screen.getByRole('button', { name: ar.claim.submit })).toBeOnTheScreen();
    expect(screen.getByTestId('claim-name')).toHaveAccessibleName(ar.claim.name);
    expectAccessibleControls();
  });

  it('Claim, signed out: the sign-in prompt in Arabic', async () => {
    const app = setup({ locale: 'ar', signedIn: false });
    apps.push(app);
    await app.ready;
    app.view(<ClaimScreen token="claimtoken-abcdef123456" />);
    expect(await screen.findByText(ar.claim.signInTitle)).toBeOnTheScreen();
    expectAccessibleControls();
  });

  it('Ticket link: the choice of tickets, named', async () => {
    const app = mount();
    await app.ready;
    app.view(<TicketLinkScreen token="11111111-1111-4111-8111-111111111111~sig" />);
    await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(1));
    expectAccessibleControls();
  });
});

describe.each(['ja', 'ru'] as const)('%s renders from its own catalog', (locale) => {
  it('My tickets and the ticket detail use the locale’s strings', async () => {
    const app = mount(locale);
    await app.ready;
    app.view(<TicketsListScreen />);
    await screen.findByTestId(`ticket-card-${IDS.t1}`);
    expect(screen.getByText(catalogs[locale].tickets.list.title)).toBeOnTheScreen();
    expect(catalogs[locale].tickets.list.title).not.toBe(en.list.title);
    expectAccessibleControls();
  });
});

describe('logical layout', () => {
  /** Physical sides never appear in the Tickets UI: start/end follow the language. */
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  const sources = [...files(join(__dirname, '../src/tickets')), ...files(join(__dirname, '../src/app'))];
  it.each(sources.map((s) => [s.replace(/^.*\/src\//, 'src/'), s]))(
    '%s has no left/right styles',
    (_name, path) => {
      const text = readFileSync(path as string, 'utf8');
      expect(text).not.toMatch(
        /\b(?:margin|padding|border)(?:Left|Right)\b|\b(?:left|right)\s*:|textAlign:\s*['"](?:left|right)['"]|flexDirection:\s*['"]row-reverse['"]/,
      );
    },
  );
});
