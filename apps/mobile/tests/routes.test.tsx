import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import TabsLayout from '../src/app/(tabs)/_layout';
import DiscoverTab from '../src/app/(tabs)/discover';
import CheckoutRoute from '../src/app/checkout/[slug]';
import ShortLinkRoute from '../src/app/e/[code]';
import EventRoute from '../src/app/events/[slug]';
import OrderRoute from '../src/app/orders/[id]';
import OrdersRoute from '../src/app/orders/index';
import OrderLinkRoute from '../src/app/orders/link/[token]';
import { ShortLinkScreen } from '../src/events/short-link-screen';
import { clearAllCarts, updateCart } from '../src/shop/cart-store';
import { createFakeShop, json } from './helpers/fake-shop';
import { ORDER_ID, SLUG } from './helpers/fixtures';
import { createFakePorts, renderApp, t } from './helpers/harness';
import { resetRouter, router, searchParams } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule);

beforeEach(() => {
  resetRouter();
  clearAllCarts();
});

describe('routes read their parameters', () => {
  it('/events/[slug] opens the event; the return link’s markers reach the screen', async () => {
    searchParams.current = { slug: SLUG };
    const shop = createFakeShop();
    await renderApp(<EventRoute />, { shop });
    expect(await screen.findByRole('header', { name: 'Summer Jazz Night' })).toBeOnTheScreen();
    expect(screen.queryByTestId('event-cancelled')).toBeNull();
  });

  it('/events/[slug]?checkout=cancelled shows the cancelled message', async () => {
    searchParams.current = { slug: SLUG, checkout: 'cancelled' };
    await renderApp(<EventRoute />);
    expect(await screen.findByTestId('event-cancelled')).toBeOnTheScreen();
  });

  it('/events/[slug]?checkout=return&order=… confirms a paid order', async () => {
    searchParams.current = { slug: SLUG, checkout: 'return', order: ORDER_ID };
    const shop = createFakeShop();
    shop.pay(ORDER_ID);
    await renderApp(<EventRoute />, { shop });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/orders/[id]',
        params: { id: ORDER_ID, placed: '1' },
      }),
    );
  });

  it('a made-up order in the link is only ever a question to the server, which answers for the person’s own orders', async () => {
    searchParams.current = { slug: SLUG, checkout: 'return', order: 'not-an-id' };
    const shop = createFakeShop();
    await renderApp(<EventRoute />, { shop });
    await screen.findByRole('header', { name: 'Summer Jazz Night' });
    expect(shop.callsTo('GET', /\/v1\/me\/orders/)).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('/checkout/[slug] opens the checkout of that event', async () => {
    searchParams.current = { slug: SLUG };
    updateCart(SLUG, { cart: { 'pass-general': 1 } });
    await renderApp(<CheckoutRoute />);
    expect(await screen.findByTestId('checkout-lines')).toBeOnTheScreen();
  });

  it('/orders is the list and /orders/[id] one order, with the “placed” marker', async () => {
    searchParams.current = {};
    await renderApp(<OrdersRoute />);
    expect(await screen.findByTestId('orders-empty')).toBeOnTheScreen();

    searchParams.current = { id: ORDER_ID, placed: 'pending' };
    await renderApp(<OrderRoute />);
    expect((await screen.findAllByTestId('order-processing')).length).toBeGreaterThan(0);
  });

  it('/orders/link/[token] and /e/[code] pass their token and code on', async () => {
    searchParams.current = { token: 'abc-123_TOKEN' };
    await renderApp(<OrderLinkRoute />, { signedIn: false });
    expect(await screen.findByTestId('order-link-banner')).toBeOnTheScreen();

    searchParams.current = { code: 'Xk3p9' };
    const ports = createFakePorts();
    await renderApp(<ShortLinkRoute />, { ports });
    await waitFor(() =>
      expect(ports.links.resolveShortCode).toHaveBeenCalledWith('https://app.yayatoh.test', 'Xk3p9'),
    );
  });

  it('the Discover tab and its tab bar', async () => {
    await renderApp(<DiscoverTab />);
    expect(await screen.findByTestId('event-event-1')).toBeOnTheScreen();
    // The tab bar is a stand-in for M7.3a's shell.
    await renderApp(<TabsLayout />);
  });
});

describe('short links', () => {
  it('opens the event the code names', async () => {
    const ports = createFakePorts();
    ports.links.resolveShortCode.mockResolvedValue('summer-jazz');
    await renderApp(<ShortLinkScreen code="Xk3p9" />, { ports });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/events/[slug]',
        params: { slug: 'summer-jazz' },
      }),
    );
    expect(ports.links.resolveShortCode).toHaveBeenCalledTimes(1);
  });

  it('shows the opening state while it looks', async () => {
    const ports = createFakePorts();
    ports.links.resolveShortCode.mockReturnValue(new Promise(() => {}));
    await renderApp(<ShortLinkScreen code="Xk3p9" />, { ports });
    expect(await screen.findByLabelText(t('en', 'discover.shortLink.opening'))).toBeOnTheScreen();
  });

  it('a code no event has says so and leads to Discover', async () => {
    const ports = createFakePorts();
    ports.links.resolveShortCode.mockResolvedValue(null);
    await renderApp(<ShortLinkScreen code="nope" />, { ports });
    expect(await screen.findByTestId('short-link-not-found')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: t('en', 'discover.shortLink.browse') }));
    expect(router.replace).toHaveBeenCalledWith('/discover');
    expect(router.replace).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/events/[slug]' }));
  });

  it('a lookup that fails offers a retry', async () => {
    const ports = createFakePorts();
    ports.links.resolveShortCode.mockRejectedValueOnce(new Error('offline'));
    await renderApp(<ShortLinkScreen code="Xk3p9" />, { ports });
    expect(await screen.findByTestId('short-link-error')).toBeOnTheScreen();
    ports.links.resolveShortCode.mockResolvedValue('summer-jazz');
    fireEvent.press(screen.getByRole('button', { name: t('en', 'core.common.retry') }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('when the configuration cannot be read, it says so and retries that', async () => {
    const shop = createFakeShop();
    let fail = true;
    shop.on('GET', '/v1/mobile/config', () =>
      fail
        ? json(500, {})
        : json(200, {
            baseUrls: { web: 'https://app.yayatoh.test', api: '' },
            apps: {},
            features: {},
            apiVersion: '1',
            latestVersions: {},
            minimumVersions: {},
          }),
    );
    const ports = createFakePorts();
    await renderApp(<ShortLinkScreen code="Xk3p9" />, { shop, ports });
    expect(await screen.findByTestId('short-link-error')).toBeOnTheScreen();
    expect(ports.links.resolveShortCode).not.toHaveBeenCalled();
    fail = false;
    fireEvent.press(screen.getByRole('button', { name: t('en', 'core.common.retry') }));
    await waitFor(() => expect(ports.links.resolveShortCode).toHaveBeenCalled());
  });

  it('Arabic reads right to left', async () => {
    const ports = createFakePorts();
    ports.links.resolveShortCode.mockResolvedValue(null);
    await renderApp(<ShortLinkScreen code="nope" />, { ports, locale: 'ar' });
    expect(await screen.findByText(t('ar', 'discover.shortLink.notFoundTitle'))).toBeOnTheScreen();
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
  });
});
