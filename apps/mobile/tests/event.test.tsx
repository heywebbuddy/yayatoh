import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { EventScreen } from '../src/events/event-screen';
import { clearAllCarts, getCartEntry, updateCart } from '../src/shop/cart-store';
import { formatEventWhen } from '../src/shop/format';
import { createFakeShop, json, problem } from './helpers/fake-shop';
import { EVENT, ORDER_ID, PASSES, pass, SLUG, WEB } from './helpers/fixtures';
import { renderApp, t } from './helpers/harness';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule);

beforeEach(() => {
  resetRouter();
  clearAllCarts();
});

const open = (marker: { outcome: 'return' | 'cancelled'; orderId: string | null } | null = null) => (
  <EventScreen slug={SLUG} marker={marker} />
);

/** A banner’s words, found whatever mark comes before them. */
const words = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

async function ready() {
  await screen.findByTestId('pass-pass-general');
}

describe('event page', () => {
  it('shows the event: name, organizer, when in the event’s zone, where, and a map link', async () => {
    const view = await renderApp(open());
    expect(await screen.findByRole('header', { name: 'Summer Jazz Night' })).toBeOnTheScreen();
    expect(screen.getByText('Live on the river')).toBeOnTheScreen();
    expect(screen.getByText('By Blue Note Lisbon')).toBeOnTheScreen();
    expect(screen.getByTestId('event-when')).toHaveTextContent(
      formatEventWhen(EVENT.startsAt, EVENT.endsAt, 'Europe/Lisbon', 'en'),
    );
    expect(screen.getByTestId('event-when')).toHaveTextContent('8:00 PM – 11:00 PM GMT+1', { exact: false });
    expect(
      screen.getByText(t('en', 'discover.event.timezone').replace('{zone}', 'Europe/Lisbon')),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('event-where')).toHaveTextContent('City Hall, Lisbon');
    fireEvent.press(await screen.findByTestId('open-maps'));
    expect(view.ports.browser.openExternal).toHaveBeenCalledWith('https://maps.example.test/city-hall');
  });

  it('shows the about text as plain words, never markup', async () => {
    const shop = createFakeShop();
    shop.on('GET', `/v1/public/events/${SLUG}/sections`, () =>
      json(200, {
        data: [
          {
            id: 's1',
            kind: 'text',
            title: 'About',
            content: { markdown: '**Doors** at 7. [Map](https://x.test)\n\n<script>x</script>' },
          },
          {
            id: 's2',
            kind: 'location',
            title: 'Getting here',
            content: { address: 'Praça do Município, Lisbon', directions: '', mapUrl: null },
          },
        ],
      }),
    );
    await renderApp(open(), { shop });
    expect(await screen.findByText(/Doors at 7\. Map/)).toBeOnTheScreen();
    expect(screen.queryByText(/<script>/)).toBeNull();
    expect(screen.getByText('Praça do Município, Lisbon')).toBeOnTheScreen();
  });

  it('applies the organizer’s brand colour through the theme when it is readable, and ignores a faint one', async () => {
    const bright = createFakeShop();
    bright.on('GET', `/v1/public/events/${SLUG}`, () => json(200, { ...EVENT, brandColor: '#0B5FFF' }));
    await renderApp(open(), { shop: bright });
    await ready();
    fireEvent.press(screen.getByTestId('increase-pass-general'));
    expect(screen.getByTestId('continue-to-checkout')).toHaveStyle({ backgroundColor: '#0B5FFF' });
  });

  it('keeps the default colours when the brand colour is too faint to read', async () => {
    const faint = createFakeShop();
    faint.on('GET', `/v1/public/events/${SLUG}`, () => json(200, { ...EVENT, brandColor: '#FFE066' }));
    await renderApp(open(), { shop: faint });
    await ready();
    fireEvent.press(screen.getByTestId('increase-pass-general'));
    expect(screen.getByTestId('continue-to-checkout')).not.toHaveStyle({ backgroundColor: '#FFE066' });
  });

  it('says a cancelled, postponed or finished event is so', async () => {
    for (const [status, key] of [
      ['cancelled', 'statusCancelled'],
      ['postponed', 'statusPostponed'],
      ['completed', 'statusEnded'],
    ] as const) {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}`, () => json(200, { ...EVENT, status }));
      const view = await renderApp(open(), { shop });
      expect(await screen.findByText(words(t('en', `discover.event.${key}`)))).toBeOnTheScreen();
      expect(screen.getByText(t('en', 'discover.event.notOnSale'))).toBeOnTheScreen();
      expect(screen.queryByTestId('pass-pass-general')).toBeNull();
      view.unmount();
    }
  });

  it('an online event has no venue line and no map', async () => {
    const shop = createFakeShop();
    shop.on('GET', `/v1/public/events/${SLUG}`, () =>
      json(200, { ...EVENT, attendanceMode: 'online', venueSlug: null, venueName: null }),
    );
    await renderApp(open(), { shop });
    expect(await screen.findByTestId('event-where')).toHaveTextContent(t('en', 'discover.event.onlineEvent'));
    expect(screen.queryByTestId('open-maps')).toBeNull();
  });

  describe('states', () => {
    it('loading', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}`, () => new Promise<Response>(() => {}));
      await renderApp(open(), { shop });
      expect(await screen.findByLabelText(t('en', 'discover.event.loading'))).toBeOnTheScreen();
    });

    it('not found', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}`, () => problem(404, 'not_found'));
      await renderApp(open(), { shop });
      expect(await screen.findByTestId('event-not-found')).toHaveTextContent(
        t('en', 'discover.event.notFoundTitle'),
        { exact: false },
      );
      fireEvent.press(screen.getByTestId('event-back'));
      expect(router.back).toHaveBeenCalled();
    });

    it('an error with a retry that works', async () => {
      const shop = createFakeShop();
      let fail = true;
      shop.on('GET', `/v1/public/events/${SLUG}`, () => {
        if (fail) throw new TypeError('Network request failed');
        return json(200, EVENT);
      });
      await renderApp(open(), { shop });
      expect(await screen.findByTestId('event-error')).toHaveTextContent(t('en', 'core.errors.network'), {
        exact: false,
      });
      fail = false;
      fireEvent.press(screen.getByRole('button', { name: t('en', 'core.common.retry') }));
      expect(await screen.findByRole('header', { name: 'Summer Jazz Night' })).toBeOnTheScreen();
    });

    it('the tickets can fail on their own, with a retry', async () => {
      const shop = createFakeShop();
      let fail = true;
      shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () =>
        fail ? problem(500, 'internal') : json(200, { data: PASSES }),
      );
      await renderApp(open(), { shop });
      expect(await screen.findByTestId('tickets-error')).toBeOnTheScreen();
      fail = false;
      fireEvent.press(
        within(screen.getByTestId('tickets-error')).getByRole('button', {
          name: t('en', 'core.common.retry'),
        }),
      );
      expect(await screen.findByTestId('pass-pass-general')).toBeOnTheScreen();
    });

    it('no tickets on sale', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () => json(200, { data: [] }));
      await renderApp(open(), { shop });
      expect(await screen.findByTestId('no-passes')).toBeOnTheScreen();
    });
  });

  describe('ticket selection (the web’s rules)', () => {
    it('shows the all-in price, and chooses quantities up to the per-order limit', async () => {
      await renderApp(open());
      await ready();
      expect(screen.getByTestId('pass-price-pass-general')).toHaveTextContent('€25.00', { exact: false });
      expect(screen.getByTestId('pass-price-pass-vip')).toHaveTextContent('€90.00', { exact: false });
      expect(screen.getByTestId('pass-pass-vip')).toHaveTextContent(t('en', 'discover.event.fewLeft'), {
        exact: false,
      });
      expect(screen.queryByTestId('cart-bar')).toBeNull();
      const inc = () => fireEvent.press(screen.getByTestId('increase-pass-vip'));
      inc();
      inc();
      expect(screen.getByTestId('quantity-pass-vip')).toHaveTextContent('2');
      // The limit is 2: a third press does nothing and the control says it is disabled.
      expect(screen.getByTestId('increase-pass-vip').props.accessibilityState).toMatchObject({
        disabled: true,
      });
      inc();
      expect(screen.getByTestId('quantity-pass-vip')).toHaveTextContent('2');
      expect(screen.getByTestId('pass-pass-vip')).toHaveTextContent('Most you can buy: 2 tickets', {
        exact: false,
      });
      fireEvent.press(screen.getByTestId('decrease-pass-vip'));
      expect(screen.getByTestId('quantity-pass-vip')).toHaveTextContent('1');
    });

    it('the total and count follow the choices', async () => {
      await renderApp(open());
      await ready();
      fireEvent.press(screen.getByTestId('increase-pass-general'));
      fireEvent.press(screen.getByTestId('increase-pass-general'));
      fireEvent.press(screen.getByTestId('increase-pass-vip'));
      expect(screen.getByTestId('cart-summary')).toHaveTextContent('3 tickets · €140.00');
      fireEvent.press(screen.getByTestId('decrease-pass-vip'));
      expect(screen.getByTestId('cart-summary')).toHaveTextContent('2 tickets · €50.00');
      fireEvent.press(screen.getByTestId('decrease-pass-general'));
      fireEvent.press(screen.getByTestId('decrease-pass-general'));
      expect(screen.queryByTestId('cart-bar')).toBeNull();
    });

    it('a pass sold in packs jumps from none to its minimum', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () =>
        json(200, { data: [pass({ minPerOrder: 2, maxPerOrder: 6 })] }),
      );
      await renderApp(open(), { shop });
      await ready();
      expect(screen.getByTestId('pass-pass-general')).toHaveTextContent('Minimum 2 tickets per order', {
        exact: false,
      });
      fireEvent.press(screen.getByTestId('increase-pass-general'));
      expect(screen.getByTestId('quantity-pass-general')).toHaveTextContent('2');
      fireEvent.press(screen.getByTestId('decrease-pass-general'));
      expect(screen.getByTestId('quantity-pass-general')).toHaveTextContent('0');
    });

    it('sold out, not yet on sale and sales ended cannot be chosen, and say why', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () =>
        json(200, {
          data: [
            pass({ id: 'a', name: 'A', availability: 'sold_out' }),
            pass({ id: 'b', name: 'B', availability: 'not_yet_on_sale' }),
            pass({ id: 'c', name: 'C', availability: 'sales_ended' }),
          ],
        }),
      );
      await renderApp(open(), { shop });
      expect(await screen.findByTestId('pass-note-a')).toHaveTextContent(t('en', 'discover.event.soldOut'));
      expect(screen.getByTestId('pass-note-b')).toHaveTextContent(t('en', 'discover.event.notYetOnSale'));
      expect(screen.getByTestId('pass-note-c')).toHaveTextContent(t('en', 'discover.event.salesEnded'));
      for (const id of ['a', 'b', 'c']) expect(screen.queryByTestId(`increase-${id}`)).toBeNull();
    });

    it('shows an early-bird price with its last day and the regular price', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () =>
        json(200, {
          data: [pass({ allInMinor: 2000, regularAllInMinor: 2500, earlyEndsAt: '2027-06-01T21:59:00Z' })],
        }),
      );
      await renderApp(open(), { shop });
      expect(await screen.findByTestId('pass-pass-general')).toHaveTextContent(
        'Early-bird price until Tue, Jun 1. Regular price €25.00.',
        { exact: false },
      );
    });

    it('a free pass reads Free and a choose-your-amount pass reads “From”', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () =>
        json(200, {
          data: [pass({ id: 'f', allInMinor: 0 }), pass({ id: 'd', isDonation: true, allInMinor: 500 })],
        }),
      );
      await renderApp(open(), { shop });
      expect(await screen.findByTestId('pass-price-f')).toHaveTextContent(t('en', 'discover.event.free'));
      expect(screen.getByTestId('pass-price-d')).toHaveTextContent('From €5.00', { exact: false });
      fireEvent.press(screen.getByTestId('increase-f'));
      expect(screen.getByTestId('cart-summary')).toHaveTextContent('1 ticket · Free');
    });

    it('steppers have spoken labels and 44-point targets', async () => {
      await renderApp(open());
      await ready();
      const up = screen.getByTestId('increase-pass-general');
      expect(up.props.accessibilityRole).toBe('button');
      expect(up.props.accessibilityLabel).toBe('Add one General admission');
      expect(screen.getByTestId('decrease-pass-general').props.accessibilityLabel).toBe(
        'Remove one General admission',
      );
      const style = Object.assign({}, ...[up.props.style].flat(Infinity).filter(Boolean));
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(screen.getByTestId('quantity-pass-general').props.accessibilityLabel).toBe(
        'General admission: 0 selected',
      );
    });

    it('Continue takes the cart to checkout, and the cart survives leaving and coming back', async () => {
      const first = await renderApp(open());
      await ready();
      fireEvent.press(screen.getByTestId('increase-pass-general'));
      fireEvent.press(screen.getByTestId('increase-pass-general'));
      fireEvent.press(screen.getByTestId('continue-to-checkout'));
      expect(router.push).toHaveBeenCalledWith({ pathname: '/checkout/[slug]', params: { slug: SLUG } });
      first.unmount();
      await renderApp(open());
      await ready();
      expect(screen.getByTestId('quantity-pass-general')).toHaveTextContent('2');
    });
  });

  describe('multi-date events', () => {
    const dates = [
      {
        id: 'd1',
        startsAt: '2027-07-10T19:00:00Z',
        endsAt: '2027-07-10T22:00:00Z',
        soldOut: false,
        status: 'scheduled',
      },
      {
        id: 'd2',
        startsAt: '2027-07-11T19:00:00Z',
        endsAt: '2027-07-11T22:00:00Z',
        soldOut: true,
        status: 'scheduled',
      },
      {
        id: 'd3',
        startsAt: '2027-07-12T19:00:00Z',
        endsAt: '2027-07-12T22:00:00Z',
        soldOut: false,
        status: 'cancelled',
      },
    ];
    const withDates = () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}/dates`, () => json(200, { data: dates, nextCursor: null }));
      return shop;
    };

    it('asks for a date before checkout, lists live dates only, and keeps the choice', async () => {
      await renderApp(open(), { shop: withDates() });
      await ready();
      expect(screen.getByTestId('date-d1')).toBeOnTheScreen();
      expect(screen.getByTestId('date-d2').props.accessibilityLabel).toContain(
        t('en', 'discover.event.soldOut'),
      );
      expect(screen.queryByTestId('date-d3')).toBeNull();
      fireEvent.press(screen.getByTestId('increase-pass-general'));
      fireEvent.press(screen.getByTestId('continue-to-checkout'));
      expect(await screen.findByTestId('choose-date-error')).toBeOnTheScreen();
      expect(router.push).not.toHaveBeenCalled();
      // A sold-out date cannot be chosen.
      fireEvent.press(screen.getByTestId('date-d2'));
      expect(getCartEntry(SLUG).occurrenceId).toBeNull();
      fireEvent.press(screen.getByTestId('date-d1'));
      expect(getCartEntry(SLUG).occurrenceId).toBe('d1');
      expect(screen.queryByTestId('choose-date-error')).toBeNull();
      fireEvent.press(screen.getByTestId('continue-to-checkout'));
      expect(router.push).toHaveBeenCalledTimes(1);
    });
  });

  describe('virtual and livestream tickets are bought on the web (P7-7)', () => {
    it('an online event shows “Buy on the web” in place of every stepper', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}`, () => json(200, { ...EVENT, attendanceMode: 'online' }));
      const view = await renderApp(open(), { shop });
      expect(await screen.findByTestId('web-only-banner')).toBeOnTheScreen();
      for (const id of ['pass-general', 'pass-vip']) {
        expect(screen.queryByTestId(`increase-${id}`)).toBeNull();
        expect(screen.getByTestId(`buy-on-web-${id}`)).toBeOnTheScreen();
      }
      expect(screen.queryByTestId('cart-bar')).toBeNull();
      await waitFor(() =>
        expect(screen.getByTestId('buy-on-web-pass-general').props.accessibilityState).toMatchObject({
          disabled: false,
        }),
      );
      fireEvent.press(screen.getByTestId('buy-on-web-pass-general'));
      expect(view.ports.browser.openWeb).toHaveBeenCalledWith(
        `${WEB}/events/${SLUG}?utm_source=yayatoh-app&utm_medium=app`,
      );
    });

    it('a hybrid event sells its in-person passes and marks the streamed ones once the server says so', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}`, () => json(200, { ...EVENT, attendanceMode: 'hybrid' }));
      await renderApp(open(), { shop });
      await ready();
      expect(screen.getByText(t('en', 'discover.event.webOnly.hybridNote'))).toBeOnTheScreen();
      expect(screen.getByTestId('increase-pass-vip')).toBeOnTheScreen();
      act(() => updateCart(SLUG, { webOnly: ['pass-vip'] }));
      expect(await screen.findByTestId('buy-on-web-pass-vip')).toBeOnTheScreen();
      expect(screen.queryByTestId('increase-pass-vip')).toBeNull();
      expect(screen.getByTestId('increase-pass-general')).toBeOnTheScreen();
      expect(screen.getByTestId('web-only-hybrid')).toBeOnTheScreen();
    });
  });

  describe('coming back from the payment page', () => {
    it('a cancel link without an order shows the cancelled message and keeps the cart', async () => {
      updateCart(SLUG, { cart: { 'pass-general': 2 } });
      await renderApp(open({ outcome: 'cancelled', orderId: null }));
      expect(await screen.findByTestId('event-cancelled')).toHaveTextContent(
        t('en', 'checkout.cancelledBody'),
        { exact: false },
      );
      await ready();
      expect(screen.getByTestId('quantity-pass-general')).toHaveTextContent('2');
    });

    it('a cancel link for an order that was not paid keeps the selection', async () => {
      updateCart(SLUG, { cart: { 'pass-general': 2 } });
      const view = await renderApp(open({ outcome: 'cancelled', orderId: ORDER_ID }));
      expect(await screen.findByTestId('event-cancelled')).toBeOnTheScreen();
      expect(view.ports.browser.dismiss).toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(getCartEntry(SLUG).cart).toEqual({ 'pass-general': 2 });
    });

    it('a return link for a paid order goes to the confirmation and empties the cart', async () => {
      const shop = createFakeShop();
      shop.pay(ORDER_ID);
      updateCart(SLUG, { cart: { 'pass-general': 2 } });
      await renderApp(open({ outcome: 'return', orderId: ORDER_ID }), { shop });
      await waitFor(() =>
        expect(router.replace).toHaveBeenCalledWith({
          pathname: '/orders/[id]',
          params: { id: ORDER_ID, placed: '1' },
        }),
      );
      expect(getCartEntry(SLUG).cart).toEqual({});
    });

    it('a return link is handled once, not on every render', async () => {
      const shop = createFakeShop();
      shop.pay(ORDER_ID);
      const view = await renderApp(open({ outcome: 'return', orderId: ORDER_ID }), { shop });
      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      void view;
      // Anything that draws the screen again must not run the link a second time.
      act(() => updateCart(SLUG, { promoCode: 'x' }));
      await new Promise((r) => setTimeout(r, 20));
      expect(shop.callsTo('GET', `/v1/me/orders/${ORDER_ID}`)).toHaveLength(1);
    });
  });

  describe('languages', () => {
    it('Arabic reads right to left, with Arabic labels', async () => {
      await renderApp(open(), { locale: 'ar' });
      await waitFor(() => expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' }));
      await screen.findByTestId('pass-pass-general');
      expect(screen.getByTestId('increase-pass-general').props.accessibilityLabel).toBe(
        t('ar', 'discover.event.increase').replace('{name}', 'General admission'),
      );
      expect(screen.getByTestId('event-back').props.accessibilityLabel).toBe(t('ar', 'discover.event.back'));
      fireEvent.press(screen.getByTestId('increase-pass-general'));
      expect(screen.getByTestId('continue-to-checkout').props.accessibilityLabel).toBe(
        t('ar', 'discover.event.continue'),
      );
    });

    it('prices are written in the person’s language and the event’s currency', async () => {
      await renderApp(open(), { locale: 'de' });
      await ready();
      expect(screen.getByTestId('pass-price-pass-general')).toHaveTextContent('25,00 €', { exact: false });
      fireEvent.press(screen.getByTestId('increase-pass-general'));
      expect(screen.getByTestId('cart-summary')).toHaveTextContent('25,00 €', { exact: false });
    });

    it('a currency with no decimals is shown without them', async () => {
      const shop = createFakeShop();
      shop.on('GET', `/v1/public/events/${SLUG}/ticket-types`, () =>
        json(200, { data: [pass({ currency: 'JPY', allInMinor: 3000 })] }),
      );
      await renderApp(open(), { shop, locale: 'ja' });
      const price = await screen.findByTestId('pass-price-pass-general');
      expect(price).toHaveTextContent('3,000', { exact: false });
      expect(price).not.toHaveTextContent('3,000.00', { exact: false });
    });
  });
});
