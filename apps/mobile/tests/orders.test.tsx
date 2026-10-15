import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { OrderLinkScreen } from '../src/orders/order-link-screen';
import { OrderScreen, POLL_LIMIT_MS } from '../src/orders/order-screen';
import { OrdersScreen } from '../src/orders/orders-screen';
import { createFakeShop, json, problem } from './helpers/fake-shop';
import { ORDER_ID, order, orderSummary, SLUG, WEB } from './helpers/fixtures';
import { renderApp, t } from './helpers/harness';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule);

beforeEach(resetRouter);

describe('orders list', () => {
  const listOf = (...orders: ReturnType<typeof orderSummary>[]) => {
    const shop = createFakeShop();
    shop.on('GET', '/v1/me/orders', (call) =>
      call.query.get('cursor') === 'c1'
        ? json(200, { data: [orderSummary(9)], nextCursor: null })
        : json(200, { data: orders, nextCursor: orders.length > 2 ? 'c1' : null }),
    );
    return shop;
  };

  it('lists the orders: event, when in its zone, status in words, tickets and total in the order’s currency', async () => {
    const shop = listOf(
      orderSummary(1),
      orderSummary(2, { status: 'refunded', totalMinor: 0, tickets: 1, currency: 'USD' }),
    );
    await renderApp(<OrdersScreen />, { shop });
    const row = await screen.findByTestId(`order-${orderSummary(1).id}`);
    expect(within(row).getByText('Order event 1')).toBeOnTheScreen();
    expect(within(row).getByText(t('en', 'orders.status.paid'))).toBeOnTheScreen();
    expect(within(row).getByText('2 tickets')).toBeOnTheScreen();
    expect(within(row).getByText('€50.00')).toBeOnTheScreen();
    const second = screen.getByTestId(`order-${orderSummary(2).id}`);
    expect(within(second).getByText(t('en', 'orders.status.refunded'))).toBeOnTheScreen();
    expect(within(second).getByText('1 ticket')).toBeOnTheScreen();
    expect(within(second).getByText(t('en', 'orders.free'))).toBeOnTheScreen();
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toContain('Order event 1');
    expect(row.props.accessibilityLabel).toContain(t('en', 'orders.status.paid'));
  });

  it('opens an order', async () => {
    await renderApp(<OrdersScreen />, { shop: listOf(orderSummary(1)) });
    fireEvent.press(await screen.findByTestId(`order-${orderSummary(1).id}`));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/orders/[id]',
      params: { id: orderSummary(1).id },
    });
  });

  it('pages by the API’s cursor', async () => {
    await renderApp(<OrdersScreen />, { shop: listOf(orderSummary(1), orderSummary(2), orderSummary(3)) });
    await screen.findByTestId(`order-${orderSummary(1).id}`);
    fireEvent.press(screen.getByTestId('orders-show-more'));
    expect(await screen.findByTestId(`order-${orderSummary(9).id}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('orders-show-more')).toBeNull();
  });

  it('has an empty state that leads to Discover', async () => {
    await renderApp(<OrdersScreen />, { shop: listOf() });
    expect(await screen.findByTestId('orders-empty')).toHaveTextContent(t('en', 'orders.emptyTitle'), {
      exact: false,
    });
    fireEvent.press(screen.getByRole('button', { name: t('en', 'orders.findEvents') }));
    expect(router.push).toHaveBeenCalledWith('/discover');
  });

  it('loading, no connection with a retry, and an expired session', async () => {
    const slow = createFakeShop();
    slow.on('GET', '/v1/me/orders', () => new Promise<Response>(() => {}));
    await renderApp(<OrdersScreen />, { shop: slow });
    expect(await screen.findByLabelText(t('en', 'orders.loading'))).toBeOnTheScreen();

    const shop = createFakeShop();
    let offline = true;
    shop.on('GET', '/v1/me/orders', () => {
      if (offline) throw new TypeError('Network request failed');
      return json(200, { data: [orderSummary(1)], nextCursor: null });
    });
    await renderApp(<OrdersScreen />, { shop });
    expect(await screen.findByTestId('orders-error')).toHaveTextContent(t('en', 'core.errors.network'), {
      exact: false,
    });
    offline = false;
    fireEvent.press(screen.getByRole('button', { name: t('en', 'core.common.retry') }));
    expect(await screen.findByTestId(`order-${orderSummary(1).id}`)).toBeOnTheScreen();
  });

  it('the back button leaves the screen, or goes home when there is nowhere to go back to', async () => {
    await renderApp(<OrdersScreen />, { shop: listOf() });
    fireEvent.press(await screen.findByTestId('orders-back'));
    expect(router.back).toHaveBeenCalled();
    router.canGoBack.mockReturnValue(false);
    fireEvent.press(screen.getByTestId('orders-back'));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('Arabic reads right to left and writes the amounts in Arabic', async () => {
    await renderApp(<OrdersScreen />, { shop: listOf(orderSummary(1)), locale: 'ar' });
    await waitFor(() => expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' }));
    const row = await screen.findByTestId(`order-${orderSummary(1).id}`);
    expect(within(row).getByText(t('ar', 'orders.status.paid'))).toBeOnTheScreen();
    expect(row.props.accessibilityHint).toBe(t('ar', 'orders.openOrder'));
    expect(screen.getByRole('header', { name: t('ar', 'orders.title') })).toBeOnTheScreen();
  });
});

describe('order', () => {
  const shopWith = (o = order()) => {
    const shop = createFakeShop();
    shop.pay(o.id, o);
    return shop;
  };

  it('shows lines, totals in the event’s currency, the status in words and the dates', async () => {
    const shop = shopWith(
      order({
        discountMinor: 500,
        feeMinor: 200,
        subtotalMinor: 5000,
        totalMinor: 4700,
        paidAt: '2027-06-01T10:01:00Z',
      }),
    );
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, { shop });
    expect(await screen.findByRole('header', { name: 'Summer Jazz Night' })).toBeOnTheScreen();
    expect(screen.getByTestId('order-status')).toHaveTextContent(t('en', 'orders.status.paid'), {
      exact: false,
    });
    expect(screen.getByTestId('order-line-pass-general')).toHaveTextContent('2 × General admission');
    const lines = screen.getByTestId('order-lines');
    // The line and the subtotal are both €50.00.
    expect(within(lines).getAllByText('€50.00')).toHaveLength(2);
    expect(within(lines).getByText('-€5.00')).toBeOnTheScreen();
    expect(within(lines).getByText('€2.00')).toBeOnTheScreen();
    expect(screen.getByTestId('order-total')).toHaveTextContent('€47.00', { exact: false });
    expect(screen.getByText('Ordered Tue, Jun 1, 11:00 AM')).toBeOnTheScreen();
    expect(screen.getByText('2 tickets')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-confirmed')).toBeNull();
  });

  it('writes the amounts for the order’s currency and the person’s language', async () => {
    const shop = shopWith(
      order({
        currency: 'JPY',
        items: [{ name: 'General', quantity: 1, ticketTypeId: 't', unitAllInMinor: 3000 }],
        subtotalMinor: 3000,
        totalMinor: 3000,
      }),
    );
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, { shop, locale: 'de' });
    expect(await screen.findByTestId('order-total')).toHaveTextContent('3.000', { exact: false });
    const de = shopWith(order({ totalMinor: 4700, subtotalMinor: 4700 }));
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, { shop: de, locale: 'de' });
    expect((await screen.findAllByTestId('order-total')).at(-1)).toHaveTextContent('47,00 €', {
      exact: false,
    });
  });

  it('after a purchase, confirms it and leads to My tickets', async () => {
    await renderApp(<OrderScreen id={ORDER_ID} placed="confirmed" />, { shop: shopWith() });
    const banner = await screen.findByTestId('order-confirmed');
    expect(banner).toHaveTextContent(t('en', 'orders.confirmed.title'), { exact: false });
    fireEvent.press(screen.getByTestId('order-view-tickets'));
    expect(router.push).toHaveBeenCalledWith('/tickets');
  });

  it('links to the event', async () => {
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, { shop: shopWith() });
    fireEvent.press(await screen.findByTestId('order-view-event'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/events/[slug]', params: { slug: SLUG } });
  });

  it.each([
    ['partially_refunded', 'orders.status.partially_refunded'],
    ['refunded', 'orders.status.refunded'],
  ] as const)('a %s order says so', async (status, key) => {
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, { shop: shopWith(order({ status })) });
    expect(await screen.findByTestId('order-status')).toHaveTextContent(t('en', key), { exact: false });
  });

  it('notes tickets passed on to someone else', async () => {
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, {
      shop: shopWith(order({ transferred: 1, ticketIds: ['t1'] })),
    });
    expect(await screen.findByText('1 ticket passed on to someone else')).toBeOnTheScreen();
  });

  describe('refunds', () => {
    const policy = (kind: 'none' | 'until' | 'always') => ({
      currency: 'EUR',
      daysBefore: 7,
      deadline: '2027-07-03T19:00:00Z',
      kind,
      retainedMinor: 0,
      timezone: 'Europe/Lisbon',
    });
    const request = (status: 'open' | 'approved' | 'declined', declineReason: string | null = null) => ({
      createdAt: '2027-06-02T10:00:00Z',
      decidedAt: null,
      declineReason,
      status,
      tickets: 1,
    });
    const panel = (latest: ReturnType<typeof request> | null) => ({
      canRequest: latest === null,
      deadline: null,
      latest,
      refusal: null,
    });

    it.each([
      ['none', 'This event doesn’t offer refunds.'.replace('’', "'")],
      ['always', 'Refunds can be requested until the event.'],
      ['until', 'Refunds can be requested until Sat, Jul 3, 8:00 PM.'],
    ] as const)('the %s policy it was bought under', async (kind, text) => {
      await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, {
        shop: shopWith(
          order({
            refundPolicy: policy(kind),
            refundRequest: { ...panel(null), deadline: kind === 'until' ? '2027-07-03T19:00:00Z' : null },
          }),
        ),
      });
      expect(await screen.findByTestId('order-refund-policy')).toHaveTextContent(text);
      expect(screen.getByText(t('en', 'orders.refund.none'))).toBeOnTheScreen();
    });

    it.each([
      ['open', 'Refund request sent'],
      ['approved', 'Refund approved'],
      ['declined', 'Refund declined'],
    ] as const)('shows a %s refund request', async (status, title) => {
      await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, {
        shop: shopWith(
          order({
            refundRequest: panel(request(status, status === 'declined' ? 'Outside the window' : null)),
          }),
        ),
      });
      const banner = await screen.findByTestId('order-refund-status');
      expect(banner).toHaveTextContent(title, { exact: false });
      expect(banner).toHaveTextContent('Requested for 1 ticket.', { exact: false });
      if (status === 'declined') expect(banner).toHaveTextContent('Outside the window', { exact: false });
    });
  });

  describe('just paid, not yet confirmed by the provider', () => {
    beforeEach(() => jest.useFakeTimers({ advanceTimers: true }));
    afterEach(() => jest.useRealTimers());

    it('explains, keeps asking, and shows the confirmation when the order appears', async () => {
      const shop = createFakeShop();
      await renderApp(<OrderScreen id={ORDER_ID} placed="pending" />, { shop });
      expect(await screen.findByTestId('order-processing')).toHaveTextContent(
        t('en', 'orders.processing.body'),
        { exact: false },
      );
      expect(screen.queryByTestId('order-not-found')).toBeNull();
      shop.pay(ORDER_ID);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3100);
      });
      expect(await screen.findByTestId('order-confirmed')).toBeOnTheScreen();
      expect(screen.queryByTestId('order-processing')).toBeNull();
    });

    it('stops asking after two minutes and says where to look later, without asking to pay again', async () => {
      const shop = createFakeShop();
      await renderApp(<OrderScreen id={ORDER_ID} placed="pending" />, { shop });
      await screen.findByTestId('order-processing');
      await act(async () => {
        await jest.advanceTimersByTimeAsync(POLL_LIMIT_MS + 100);
      });
      const banner = await screen.findByTestId('order-processing');
      expect(banner).toHaveTextContent(t('en', 'orders.processing.stillBody'), { exact: false });
      const before = shop.callsTo('GET', `/v1/me/orders/${ORDER_ID}`).length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      expect(shop.callsTo('GET', `/v1/me/orders/${ORDER_ID}`).length).toBe(before);
      fireEvent.press(screen.getByTestId('order-view-orders'));
      expect(router.replace).toHaveBeenCalledWith('/orders');
    });
  });

  it('an order that is not the person’s is not found', async () => {
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, { shop: createFakeShop() });
    expect(await screen.findByTestId('order-not-found')).toHaveTextContent(t('en', 'orders.notFoundTitle'), {
      exact: false,
    });
  });

  it('loading, errors with a retry, and an expired session', async () => {
    const slow = createFakeShop();
    slow.on('GET', `/v1/me/orders/${ORDER_ID}`, () => new Promise<Response>(() => {}));
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, { shop: slow });
    expect(await screen.findByLabelText(t('en', 'orders.loading'))).toBeOnTheScreen();

    const shop = createFakeShop();
    let fail = true;
    shop.on('GET', `/v1/me/orders/${ORDER_ID}`, () => (fail ? problem(500, 'internal') : json(200, order())));
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, { shop });
    expect(await screen.findByTestId('order-error')).toHaveTextContent(t('en', 'core.errors.generic'), {
      exact: false,
    });
    fail = false;
    fireEvent.press(screen.getByRole('button', { name: t('en', 'core.common.retry') }));
    expect(await screen.findByRole('header', { name: 'Summer Jazz Night' })).toBeOnTheScreen();

    const expired = createFakeShop();
    expired.on('GET', `/v1/me/orders/${ORDER_ID}`, () => problem(401, 'unauthenticated'));
    await renderApp(<OrderScreen id={ORDER_ID} placed={null} />, { shop: expired });
    expect(await screen.findByTestId('order-error')).toHaveTextContent(t('en', 'orders.signInAgain'), {
      exact: false,
    });
  });

  it('Arabic reads right to left with labelled actions', async () => {
    await renderApp(<OrderScreen id={ORDER_ID} placed="confirmed" />, { shop: shopWith(), locale: 'ar' });
    await waitFor(() => expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' }));
    expect((await screen.findByTestId('order-view-tickets')).props.accessibilityLabel).toBe(
      t('ar', 'orders.confirmed.action'),
    );
    expect(screen.getByTestId('order-back').props.accessibilityLabel).toBe(t('ar', 'orders.back'));
    expect(screen.getByTestId('order-view-event').props.accessibilityRole).toBe('button');
  });
});

describe('order links from email', () => {
  it('opens the web order page in the secure browser', async () => {
    const view = await renderApp(<OrderLinkScreen token="abc-123_TOKEN" />, { signedIn: false });
    await waitFor(() =>
      expect(screen.getByTestId('order-link-open').props.accessibilityState.disabled).toBe(false),
    );
    fireEvent.press(screen.getByTestId('order-link-open'));
    expect(view.ports.browser.openWeb).toHaveBeenCalledWith(`${WEB}/orders/abc-123_TOKEN`);
    fireEvent.press(screen.getByTestId('order-link-orders'));
    expect(router.replace).toHaveBeenCalledWith('/orders');
  });
});
