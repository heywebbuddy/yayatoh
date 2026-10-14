import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { CheckoutScreen } from '../src/checkout/checkout-screen';
import { clearAllCarts, getCartEntry, updateCart } from '../src/shop/cart-store';
import { createFakeShop, json, problem } from './helpers/fake-shop';
import { ORDER_ID, pass, PASSES, SLUG, WEB } from './helpers/fixtures';
import { createFakePorts, renderApp, t } from './helpers/harness';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule);

beforeEach(() => {
  resetRouter();
  clearAllCarts();
  updateCart(SLUG, { cart: { 'pass-general': 2 } });
});

const words = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const open = () => <CheckoutScreen slug={SLUG} />;
const checkoutCalls = (shop: ReturnType<typeof createFakeShop>) => shop.callsTo('POST', `/v1/public/events/${SLUG}/checkout`);
const payButton = () => screen.getByTestId('checkout-pay');
async function ready() {
  await screen.findByTestId('checkout-lines');
  await waitFor(() => expect(payButton().props.accessibilityState.disabled).toBe(false));
}
const paymentReturn = (outcome: 'return' | 'cancelled', order = ORDER_ID) =>
  ({ type: 'return', url: `${WEB}/events/${SLUG}?checkout=${outcome}&order=${order}` }) as const;

describe('checkout review', () => {
  it('lists the lines and the all-in total, and offers to pay it', async () => {
    await renderApp(open());
    await ready();
    expect(screen.getByTestId('line-pass-general')).toHaveTextContent('2 × General admission');
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('€50.00');
    expect(payButton().props.accessibilityLabel).toBe('Pay €50.00');
    expect(screen.getByText('Your tickets will be sent to ada@example.test.')).toBeOnTheScreen();
    expect(screen.getByTestId('checkout-name').props.value).toBe('Ada');
    expect(screen.getByText(t('en', 'checkout.holdNote'))).toBeOnTheScreen();
  });

  it('writes the total in the person’s language', async () => {
    await renderApp(open(), { locale: 'de' });
    await screen.findByTestId('checkout-lines');
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('50,00 €');
    await waitFor(() => expect(payButton().props.accessibilityLabel).toBe(t('de', 'checkout.pay').replace('{total}', '50,00 €')));
  });

  it('with nothing selected, sends the person back to the event', async () => {
    clearAllCarts();
    await renderApp(open());
    expect(await screen.findByTestId('checkout-empty')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: t('en', 'checkout.backToEvent') }));
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/events/[slug]', params: { slug: SLUG } });
  });

  it('refuses a selection the page would not allow, and says which pass', async () => {
    const shop = createFakeShop();
    shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () =>
      json(200, { data: [pass({ availability: 'sold_out' }), PASSES[1]] }),
    );
    await renderApp(open(), { shop });
    expect(await screen.findByTestId('checkout-issues')).toHaveTextContent("General admission isn't available any more", { exact: false });
    expect(payButton().props.accessibilityState.disabled).toBe(true);
    fireEvent.press(payButton());
    expect(checkoutCalls(shop)).toHaveLength(0);
  });

  it('a quantity below the pass minimum or above its maximum is refused', async () => {
    const shop = createFakeShop();
    shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () => json(200, { data: [pass({ minPerOrder: 3, maxPerOrder: 4 })] }));
    await renderApp(open(), { shop });
    expect(await screen.findByTestId('checkout-issues')).toHaveTextContent('General admission needs at least 3 tickets.', { exact: false });
    updateCart(SLUG, { cart: { 'pass-general': 5 } });
    expect(await screen.findByText(/allows up to 4 tickets per order/)).toBeOnTheScreen();
  });

  it('loading and load errors', async () => {
    const slow = createFakeShop();
    slow.on('GET', `/v1/public/events/${SLUG}`, () => new Promise<Response>(() => {}));
    await renderApp(open(), { shop: slow });
    expect(await screen.findByLabelText(t('en', 'checkout.loading'))).toBeOnTheScreen();
    const broken = createFakeShop();
    broken.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () => problem(500, 'internal'));
    await renderApp(open(), { shop: broken });
    expect(await screen.findByTestId('checkout-load-error')).toBeOnTheScreen();
  });
});

describe('who can buy', () => {
  it('a signed-out person is asked to sign in and cannot pay', async () => {
    await renderApp(open(), { signedIn: false });
    expect(await screen.findByTestId('checkout-sign-in')).toBeOnTheScreen();
    expect(payButton().props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('checkout-sign-in-button'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/', params: { returnTo: `/checkout/${SLUG}` } });
  });

  it('an unverified email must be verified first', async () => {
    const shop = createFakeShop();
    await renderApp(open(), { shop, user: { emailVerified: false } });
    expect(await screen.findByTestId('checkout-unverified')).toHaveTextContent(t('en', 'checkout.errors.unverifiedEmail'), { exact: false });
    expect(payButton().props.accessibilityState.disabled).toBe(true);
  });
});

describe('a fake-provider purchase', () => {
  it('holds the cart with an idempotency key, opens the payment page, and ends on the confirmation', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    ports.browser.openPayment.mockImplementationOnce(async (url) => {
      const orderId = new URL(url).searchParams.get('order') ?? '';
      shop.pay(orderId);
      return paymentReturn('return', orderId);
    });
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.changeText(screen.getByTestId('checkout-name'), 'Ada Lovelace');
    fireEvent.press(payButton());

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const call = checkoutCalls(shop)[0];
    expect(call?.headers.get('idempotency-key')).toBe('key-1');
    expect(call?.headers.get('authorization')).toBe('Bearer access-1');
    expect(call?.body).toEqual({ items: [{ ticketTypeId: 'pass-general', quantity: 2 }], name: 'Ada Lovelace' });
    const [url, returnTo] = ports.browser.openPayment.mock.calls[0] ?? [];
    expect(url).toMatch(`${WEB}/checkout/fake?order=`);
    // The auth session watches for the event page the return and cancel links point to.
    expect(returnTo).toBe(`${WEB}/events/${SLUG}`);
    const orderId = [...shop.created.keys()][0];
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/orders/[id]', params: { id: orderId, placed: '1' } });
    expect(getCartEntry(SLUG).cart).toEqual({});
    expect(shop.created.size).toBe(1);
  });

  it('sends the promo code and shows the server’s answer when it is not valid', async () => {
    const shop = createFakeShop();
    shop.nextCheckout = () => problem(422, 'validation_failed', { reason: 'promo_invalid' });
    await renderApp(open(), { shop });
    await ready();
    fireEvent.changeText(screen.getByTestId('checkout-promo'), 'NOPE10');
    fireEvent.press(payButton());
    expect(await screen.findByText(t('en', 'checkout.errors.promoInvalid'))).toBeOnTheScreen();
    expect(checkoutCalls(shop)[0]?.body).toMatchObject({ promoCode: 'NOPE10' });
    // Nothing was placed, the code stays in the field and the cart is intact.
    expect(screen.getByTestId('checkout-promo').props.value).toBe('NOPE10');
    expect(getCartEntry(SLUG).cart).toEqual({ 'pass-general': 2 });
    expect(screen.queryByTestId('checkout-error')).toBeNull();
  });

  it('a free cart is paid at once and goes straight to the confirmation, with no browser', async () => {
    const shop = createFakeShop();
    shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () => json(200, { data: [pass({ allInMinor: 0 })] }));
    shop.nextCheckout = () => json(201, { action: 'paid', orderId: ORDER_ID, paymentUrl: null, expiresAt: null, webUrl: null, webReason: null });
    const ports = createFakePorts();
    await renderApp(open(), { shop, ports });
    await ready();
    expect(payButton().props.accessibilityLabel).toBe(t('en', 'checkout.getTickets'));
    expect(screen.queryByTestId('checkout-promo')).toBeNull();
    fireEvent.press(payButton());
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({ pathname: '/orders/[id]', params: { id: ORDER_ID, placed: '1' } }),
    );
    expect(ports.browser.openPayment).not.toHaveBeenCalled();
    expect(getCartEntry(SLUG).cart).toEqual({});
  });

  it('a double tap makes one request', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    fireEvent.press(payButton());
    await waitFor(() => expect(ports.browser.openPayment).toHaveBeenCalled());
    expect(checkoutCalls(shop)).toHaveLength(1);
    expect(shop.created.size).toBe(1);
  });

  it('shows what is happening while the order is held and the payment page opens', async () => {
    const shop = createFakeShop();
    let release: (r: Response) => void = () => {};
    shop.nextCheckout = () => new Promise<Response>((resolve) => (release = resolve));
    await renderApp(open(), { shop });
    await ready();
    fireEvent.press(payButton());
    expect(await screen.findByTestId('checkout-starting')).toBeOnTheScreen();
    expect(payButton().props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    release(problem(500, 'internal'));
    expect(await screen.findByTestId('checkout-error')).toBeOnTheScreen();
  });
});

describe('cancelling and replaying', () => {
  it('cancelling the payment returns with the selection intact and nothing bought', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    ports.browser.openPayment.mockResolvedValueOnce(paymentReturn('cancelled', '00000000-0000-4000-8000-000000000001'));
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    expect(await screen.findByTestId('checkout-cancelled')).toHaveTextContent(t('en', 'checkout.cancelledBody'), { exact: false });
    expect(router.replace).not.toHaveBeenCalled();
    expect(getCartEntry(SLUG).cart).toEqual({ 'pass-general': 2 });
    expect(screen.getByTestId('line-pass-general')).toBeOnTheScreen();
    expect(payButton().props.accessibilityLabel).toBe(t('en', 'checkout.payAgain'));
  });

  it('closing the sheet without paying is the same as cancelling', async () => {
    const ports = createFakePorts();
    ports.browser.openPayment.mockResolvedValueOnce({ type: 'closed' });
    await renderApp(open(), { ports });
    await ready();
    fireEvent.press(payButton());
    expect(await screen.findByTestId('checkout-cancelled')).toBeOnTheScreen();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('closing the sheet after paying still finds the order paid', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    ports.browser.openPayment.mockImplementationOnce(async (url) => {
      shop.pay(new URL(url).searchParams.get('order') ?? '');
      return { type: 'closed' };
    });
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(router.replace.mock.calls[0]?.[0]).toMatchObject({ params: { placed: '1' } });
  });

  it('a cancel link is checked once before it is believed, so a payment that went through is not lost', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    ports.browser.openPayment.mockImplementationOnce(async (url) => {
      const orderId = new URL(url).searchParams.get('order') ?? '';
      shop.pay(orderId);
      return paymentReturn('cancelled', orderId);
    });
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('paying again after a cancel replays the same key, so there is never a second order', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    ports.browser.openPayment.mockResolvedValueOnce({ type: 'closed' });
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    await screen.findByTestId('checkout-cancelled');
    ports.browser.openPayment.mockImplementationOnce(async (url) => {
      shop.pay(new URL(url).searchParams.get('order') ?? '');
      return paymentReturn('return', new URL(url).searchParams.get('order') ?? '');
    });
    fireEvent.press(payButton());
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const calls = checkoutCalls(shop);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get('idempotency-key')).toBe(calls[0]?.headers.get('idempotency-key'));
    expect(shop.created.size).toBe(1);
    expect(ports.keys).toEqual(['key-1']);
  });

  it('changing the cart takes a new key', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    await screen.findByTestId('checkout-cancelled');
    updateCart(SLUG, { cart: { 'pass-general': 3 } });
    await waitFor(() => expect(screen.getByTestId('line-pass-general')).toHaveTextContent('3 × General admission'));
    fireEvent.press(payButton());
    await waitFor(() => expect(checkoutCalls(shop)).toHaveLength(2));
    expect(ports.keys).toEqual(['key-1', 'key-2']);
    expect(shop.created.size).toBe(2);
  });

  it('a promo code change is a different cart too', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    await screen.findByTestId('checkout-cancelled');
    fireEvent.changeText(screen.getByTestId('checkout-promo'), 'SAVE10');
    fireEvent.press(payButton());
    await waitFor(() => expect(checkoutCalls(shop)).toHaveLength(2));
    expect(ports.keys).toEqual(['key-1', 'key-2']);
  });

  it('a lapsed hold takes a fresh key on the next try', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    shop.nextCheckout = () => problem(409, 'invalid_state', { reason: 'hold_expired' });
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent(t('en', 'checkout.errors.holdExpired'), { exact: false });
    shop.nextCheckout = null;
    fireEvent.press(payButton());
    await waitFor(() => expect(ports.browser.openPayment).toHaveBeenCalled());
    expect(ports.keys).toEqual(['key-1', 'key-2']);
  });
});

describe('after paying, while the provider confirms', () => {
  it('waits for a normal return, and goes on when the order shows up', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    let waits = 0;
    ports.wait = async () => {
      waits += 1;
      if (waits === 2) shop.pay([...shop.created.keys()][0] ?? '');
    };
    ports.browser.openPayment.mockImplementationOnce(async (url) => paymentReturn('return', new URL(url).searchParams.get('order') ?? ''));
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(router.replace.mock.calls[0]?.[0]).toMatchObject({ params: { placed: '1' } });
    expect(waits).toBe(2);
  });

  it('after the last read, a normal return goes to the order screen as still confirming', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    ports.browser.openPayment.mockImplementationOnce(async (url) => paymentReturn('return', new URL(url).searchParams.get('order') ?? ''));
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(router.replace.mock.calls[0]?.[0]).toMatchObject({ params: { placed: 'pending' } });
    expect(shop.callsTo('GET', /\/v1\/me\/orders\//)).toHaveLength(5);
    expect(getCartEntry(SLUG).cart).toEqual({});
  });
});

describe('carts the app cannot finish', () => {
  it.each([
    ['checkout_questions'],
    ['seat_selection'],
    ['registration'],
    ['transfer_fee'],
    ['choose_your_amount'],
  ])('%s: explains why, holds nothing and opens the web checkout', async (reason) => {
    const shop = createFakeShop();
    const webUrl = `${WEB}/events/${SLUG}?utm_source=yayatoh-app&utm_medium=app`;
    shop.nextCheckout = () => json(200, { action: 'web', orderId: null, paymentUrl: null, expiresAt: null, webUrl, webReason: reason });
    const ports = createFakePorts();
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    const banner = await screen.findByTestId('checkout-web');
    expect(banner).toHaveTextContent(t('en', `checkout.web.reason.${reason}`), { exact: false });
    expect(banner).toHaveTextContent(t('en', 'checkout.web.keep'), { exact: false });
    expect(ports.browser.openPayment).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('checkout-web-button'));
    expect(ports.browser.openWeb).toHaveBeenCalledWith(webUrl);
    expect(shop.created.size).toBe(0);
    expect(getCartEntry(SLUG).cart).toEqual({ 'pass-general': 2 });
  });
});

describe('virtual and livestream tickets are never bought here (P7-7)', () => {
  it('a 409 buy_on_web refuses the cart, marks the pass web-only, keeps the rest and offers the web', async () => {
    const shop = createFakeShop();
    const webUrl = `${WEB}/events/${SLUG}?utm_source=yayatoh-app&utm_medium=app`;
    shop.nextCheckout = () => problem(409, 'invalid_state', { reason: 'buy_on_web', webUrl, ticketTypeIds: ['pass-vip'] });
    const ports = createFakePorts();
    updateCart(SLUG, { cart: { 'pass-general': 1, 'pass-vip': 1 } });
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    const banner = await screen.findByTestId('checkout-buy-on-web');
    expect(banner).toHaveTextContent(t('en', 'checkout.buyOnWeb.body'), { exact: false });
    expect(ports.browser.openPayment).not.toHaveBeenCalled();
    expect(getCartEntry(SLUG).webOnly).toEqual(['pass-vip']);
    expect(getCartEntry(SLUG).cart).toEqual({ 'pass-general': 1, 'pass-vip': 1 });
    fireEvent.press(screen.getByTestId('checkout-buy-on-web-button'));
    expect(ports.browser.openWeb).toHaveBeenCalledWith(webUrl);
    // The pass can't be paid for here any more: the screen says so and Pay is off until it is removed.
    expect(await screen.findByTestId('checkout-issues')).toHaveTextContent('VIP table is bought on the web', { exact: false });
    expect(payButton().props.accessibilityState.disabled).toBe(true);
    expect(shop.created.size).toBe(0);
  });

  it('a cart already known to hold a web-only pass cannot be sent at all', async () => {
    const shop = createFakeShop();
    updateCart(SLUG, { cart: { 'pass-vip': 1 }, webOnly: ['pass-vip'] });
    await renderApp(open(), { shop });
    expect(await screen.findByTestId('checkout-issues')).toBeOnTheScreen();
    fireEvent.press(payButton());
    expect(checkoutCalls(shop)).toHaveLength(0);
  });

  it('an online event’s passes cannot be bought here whatever the cart says', async () => {
    const shop = createFakeShop();
    shop.on('GET', `/v1/public/events/${SLUG}`, () =>
      json(200, { attendanceMode: 'online', category: 'music', city: null, currency: 'EUR', endsAt: '2027-07-10T22:00:00Z', name: 'Stream', organizerName: 'Org', profile: 'concert', slug: SLUG, startsAt: '2027-07-10T19:00:00Z', status: 'published', tagline: null, timezone: 'UTC', venueName: null, venueSlug: null }),
    );
    await renderApp(open(), { shop });
    expect(await screen.findByTestId('checkout-issues')).toHaveTextContent('is bought on the web', { exact: false });
    expect(payButton().props.accessibilityState.disabled).toBe(true);
  });
});

describe('failures', () => {
  const cases: [string, () => Response | never, string][] = [
    ['no connection', () => { throw new TypeError('Network request failed'); }, 'checkout.errors.network'],
    ['a server error', () => problem(500, 'internal'), 'checkout.errors.unknown'],
    ['a risk block', () => problem(403, 'forbidden', { reason: 'risk_blocked' }), 'checkout.errors.riskBlocked'],
    ['a suspended organizer', () => problem(409, 'invalid_state', { reason: 'org_suspended' }), 'checkout.errors.orgSuspended'],
    ['sold out', () => problem(409, 'conflict', { reason: 'sold_out' }), 'checkout.errors.soldOut'],
    ['a vanished event', () => problem(404, 'not_found'), 'checkout.errors.notFound'],
    ['an expired session', () => problem(401, 'unauthenticated'), 'checkout.errors.unauthenticated'],
    ['a reused key', () => problem(422, 'idempotency_key_reused'), 'checkout.errors.changed'],
    ['an unverified email', () => problem(403, 'forbidden', { reason: 'email_unverified' }), 'checkout.errors.unverifiedEmail'],
    ['a bad request', () => problem(400, 'validation_failed'), 'checkout.errors.invalid'],
  ];

  it.each(cases)('%s: a clear message, nothing placed, the cart kept, and the person can try again', async (_name, answer, key) => {
    const shop = createFakeShop();
    shop.nextCheckout = answer;
    const ports = createFakePorts();
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent(t('en', key), { exact: false });
    expect(ports.browser.openPayment).not.toHaveBeenCalled();
    expect(getCartEntry(SLUG).cart).toEqual({ 'pass-general': 2 });
    expect(payButton().props.accessibilityState.disabled).toBe(false);
  });

  it('a rate limit says how long to wait', async () => {
    const shop = createFakeShop();
    shop.nextCheckout = () => problem(429, 'rate_limited', {}, { 'retry-after': '125' });
    await renderApp(open(), { shop });
    await ready();
    fireEvent.press(payButton());
    expect(await screen.findByText(words('Try again in 3 minutes.'))).toBeOnTheScreen();
  });

  it('an offline retry with the same cart replays the same key', async () => {
    const shop = createFakeShop();
    const ports = createFakePorts();
    shop.nextCheckout = () => { throw new TypeError('Network request failed'); };
    await renderApp(open(), { shop, ports });
    await ready();
    fireEvent.press(payButton());
    await screen.findByTestId('checkout-error');
    shop.nextCheckout = null;
    fireEvent.press(payButton());
    await waitFor(() => expect(ports.browser.openPayment).toHaveBeenCalled());
    const keys = checkoutCalls(shop).map((c) => c.headers.get('idempotency-key'));
    expect(keys).toEqual(['key-1', 'key-1']);
  });
});

describe('languages and access', () => {
  it('Arabic reads right to left with Arabic labels and an accessible pay button', async () => {
    await renderApp(open(), { locale: 'ar' });
    await waitFor(() => expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' }));
    await screen.findByTestId('checkout-lines');
    expect(screen.getByRole('header', { name: t('ar', 'checkout.title') })).toBeOnTheScreen();
    expect(screen.getByTestId('checkout-back').props.accessibilityLabel).toBe(t('ar', 'checkout.backToEvent'));
    expect(screen.getByTestId('checkout-promo').props.accessibilityLabel).toBe(t('ar', 'checkout.promoLabel'));
    expect(payButton().props.accessibilityRole).toBe('button');
    const style = Object.assign({}, ...[payButton().props.style].flat(Infinity).filter(Boolean));
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });
});
