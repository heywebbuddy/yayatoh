import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { DiscoverScreen } from '../src/discover/discover-screen';
import { formatEventStart, formatPriceRange } from '../src/shop/format';
import { createFakeShop, json, problem } from './helpers/fake-shop';
import { summary } from './helpers/fixtures';
import { createFakePorts, renderApp, t } from './helpers/harness';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule);

beforeEach(resetRouter);

const searches = (shop: ReturnType<typeof createFakeShop>) => shop.callsTo('GET', '/v1/public/events');
const lastSearch = (shop: ReturnType<typeof createFakeShop>) => searches(shop).at(-1)?.query;

describe('Discover', () => {
  it('lists upcoming events soonest first, with when (in the event’s zone), place, price and organizer', async () => {
    const shop = createFakeShop();
    await renderApp(<DiscoverScreen />, { shop });
    expect(await screen.findByTestId('event-event-1')).toBeOnTheScreen();
    expect(screen.getByTestId('event-event-2')).toBeOnTheScreen();
    expect(screen.getByTestId('sort-order')).toHaveTextContent(t('en', 'discover.sortSoonest'));
    const card = screen.getByTestId('event-event-1');
    expect(within(card).getByText('Event 1')).toBeOnTheScreen();
    expect(within(card).getByText('Blue Note Lisbon')).toBeOnTheScreen();
    expect(within(card).getByText('City Hall, Lisbon')).toBeOnTheScreen();
    expect(within(card).getByText(formatEventStart('2027-07-10T19:00:00Z', 'Europe/Lisbon', 'en'))).toBeOnTheScreen();
    expect(within(card).getByText('From €25.00 – €90.00')).toBeOnTheScreen();
    expect(lastSearch(shop)?.get('limit')).toBe('20');
  });

  it('every result has one spoken description with its role', async () => {
    await renderApp(<DiscoverScreen />);
    const card = await screen.findByTestId('event-event-1');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toContain('Event 1');
    expect(card.props.accessibilityLabel).toContain('Blue Note Lisbon');
    expect(card.props.accessibilityLabel).toContain('City Hall, Lisbon');
    expect(card.props.accessibilityHint).toBe(t('en', 'discover.openEvent'));
  });

  it('opens the event page when a result is tapped', async () => {
    await renderApp(<DiscoverScreen />);
    fireEvent.press(await screen.findByTestId('event-event-2'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/events/[slug]', params: { slug: 'event-2' } });
  });

  it('marks cancelled and postponed events with words', async () => {
    const shop = createFakeShop();
    shop.on('GET', '/v1/public/events', () =>
      json(200, { data: [summary(1, { status: 'cancelled' }), summary(2, { status: 'postponed' })], nextCursor: null }),
    );
    await renderApp(<DiscoverScreen />, { shop });
    expect(await within(await screen.findByTestId('event-event-1')).findByText(t('en', 'discover.statusCancelled'))).toBeOnTheScreen();
    expect(within(screen.getByTestId('event-event-2')).getByText(t('en', 'discover.statusPostponed'))).toBeOnTheScreen();
  });

  describe('search', () => {
    it('searches for the words once the person pauses typing', async () => {
      const shop = createFakeShop();
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      fireEvent.changeText(screen.getByTestId('discover-search'), 'jazz');
      // Not yet: the person may still be typing.
      expect(lastSearch(shop)?.get('q')).toBeNull();
      await waitFor(() => expect(lastSearch(shop)?.get('q')).toBe('jazz'));
    });

    it('clears the search with a button', async () => {
      const shop = createFakeShop();
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      fireEvent.changeText(screen.getByTestId('discover-search'), 'jazz');
      await waitFor(() => expect(lastSearch(shop)?.get('q')).toBe('jazz'));
      fireEvent.press(screen.getByTestId('discover-clear-search'));
      await waitFor(() => expect(lastSearch(shop)?.get('q')).toBeNull());
      expect(screen.getByTestId('discover-search').props.value).toBe('');
    });

    it('filters by category and back to all', async () => {
      const shop = createFakeShop();
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      fireEvent.press(screen.getByTestId('category-music'));
      await waitFor(() => expect(lastSearch(shop)?.get('category')).toBe('music'));
      expect(screen.getByTestId('category-music').props.accessibilityState).toMatchObject({ selected: true });
      fireEvent.press(screen.getByTestId('category-all'));
      await waitFor(() => expect(lastSearch(shop)?.get('category')).toBeNull());
    });

    it('names every category in the person’s language', async () => {
      await renderApp(<DiscoverScreen />, { locale: 'de' });
      await screen.findByTestId('event-event-1');
      expect(screen.getByTestId('category-music').props.accessibilityLabel).toBe(t('de', 'discover.categories.music'));
      expect(t('de', 'discover.categories.music')).not.toBe(t('en', 'discover.categories.music'));
    });
  });

  describe('date range', () => {
    it('quick choices send the dates on the person’s calendar, and toggle off', async () => {
      const shop = createFakeShop();
      await renderApp(<DiscoverScreen />, { shop, ports: createFakePorts(new Date(2027, 4, 5, 12)) });
      await screen.findByTestId('event-event-1');
      fireEvent.press(screen.getByTestId('when-weekend'));
      await waitFor(() => expect(lastSearch(shop)?.get('from')).toBe('2027-05-07'));
      expect(lastSearch(shop)?.get('to')).toBe('2027-05-09');
      expect(screen.getByTestId('when-weekend').props.accessibilityState).toMatchObject({ selected: true });
      fireEvent.press(screen.getByTestId('when-weekend'));
      await waitFor(() => expect(lastSearch(shop)?.get('from')).toBeNull());
      fireEvent.press(screen.getByTestId('when-month'));
      await waitFor(() => expect(lastSearch(shop)?.get('to')).toBe('2027-05-31'));
      fireEvent.press(screen.getByTestId('when-any'));
      await waitFor(() => expect(lastSearch(shop)?.get('to')).toBeNull());
    });

    it('typed dates are searched once they are real dates, with a message for each mistake', async () => {
      const shop = createFakeShop();
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      fireEvent.press(screen.getByTestId('when-custom'));
      fireEvent.changeText(screen.getByTestId('date-from'), 'soon');
      expect(await screen.findByText(t('en', 'discover.dateError.from_format'))).toBeOnTheScreen();
      expect(lastSearch(shop)?.get('from')).toBeNull();
      fireEvent.changeText(screen.getByTestId('date-from'), '2027-05-31');
      fireEvent.changeText(screen.getByTestId('date-to'), '2027-05-01');
      expect(await screen.findByText(t('en', 'discover.dateError.order'))).toBeOnTheScreen();
      fireEvent.changeText(screen.getByTestId('date-to'), '31 May');
      expect(await screen.findByText(t('en', 'discover.dateError.to_format'))).toBeOnTheScreen();
      fireEvent.changeText(screen.getByTestId('date-from'), '2027-05-01');
      fireEvent.changeText(screen.getByTestId('date-to'), '2027-05-31');
      await waitFor(() => expect(lastSearch(shop)?.get('from')).toBe('2027-05-01'));
      expect(lastSearch(shop)?.get('to')).toBe('2027-05-31');
      expect(screen.queryByText(t('en', 'discover.dateError.order'))).toBeNull();
    });
  });

  describe('near me', () => {
    it('asks for the location only when the person taps it, never on open', async () => {
      const ports = createFakePorts();
      await renderApp(<DiscoverScreen />, { ports });
      await screen.findByTestId('event-event-1');
      expect(ports.location.requestNearMe).not.toHaveBeenCalled();
      fireEvent.press(screen.getByTestId('near-me'));
      expect(ports.location.requestNearMe).toHaveBeenCalledTimes(1);
    });

    it('sorts nearest first, shows the distance, and sends a position rounded to about a kilometre', async () => {
      const shop = createFakeShop();
      shop.on('GET', '/v1/public/events', (call) =>
        json(200, {
          data: [summary(1, { distanceKm: call.query.get('lat') ? 3.4 : null })],
          nextCursor: null,
        }),
      );
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      fireEvent.press(screen.getByTestId('near-me'));
      await waitFor(() => expect(lastSearch(shop)?.get('lat')).toBe('38.72'));
      expect(lastSearch(shop)?.get('lng')).toBe('-9.14');
      expect(lastSearch(shop)?.get('radiusKm')).toBe('25');
      expect(await screen.findByText(t('en', 'discover.sortNearest'))).toBeOnTheScreen();
      expect(within(screen.getByTestId('event-event-1')).getByText('3.4 km away')).toBeOnTheScreen();
      expect(screen.getByTestId('near-me').props.accessibilityState).toMatchObject({ selected: true });
      // Tapping again turns it off.
      fireEvent.press(screen.getByTestId('near-me'));
      await waitFor(() => expect(lastSearch(shop)?.get('lat')).toBeNull());
      expect(await screen.findByText(t('en', 'discover.sortSoonest'))).toBeOnTheScreen();
    });

    it('explains a refusal and lets the person try again', async () => {
      const ports = createFakePorts();
      ports.location.requestNearMe.mockResolvedValueOnce({ status: 'denied', canAskAgain: true });
      await renderApp(<DiscoverScreen />, { ports });
      await screen.findByTestId('event-event-1');
      fireEvent.press(screen.getByTestId('near-me'));
      expect(await screen.findByTestId('near-me-denied')).toHaveTextContent(t('en', 'discover.nearMeDenied'), { exact: false });
      expect(screen.queryByText(t('en', 'discover.openSettings'))).toBeNull();
      fireEvent.press(screen.getByTestId('near-me'));
      await waitFor(() => expect(screen.queryByTestId('near-me-denied')).toBeNull());
    });

    it('sends a person who blocked the permission to Settings', async () => {
      const ports = createFakePorts();
      ports.location.requestNearMe.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
      await renderApp(<DiscoverScreen />, { ports });
      await screen.findByTestId('event-event-1');
      fireEvent.press(screen.getByTestId('near-me'));
      expect(await screen.findByTestId('near-me-denied')).toHaveTextContent(t('en', 'discover.nearMeBlocked'), { exact: false });
      fireEvent.press(screen.getByRole('button', { name: t('en', 'discover.openSettings') }));
      expect(ports.location.openSettings).toHaveBeenCalled();
    });

    it('says so when the phone cannot find its position', async () => {
      const ports = createFakePorts();
      ports.location.requestNearMe.mockResolvedValueOnce({ status: 'unavailable' });
      const shop = createFakeShop();
      await renderApp(<DiscoverScreen />, { ports, shop });
      await screen.findByTestId('event-event-1');
      fireEvent.press(screen.getByTestId('near-me'));
      expect(await screen.findByTestId('near-me-unavailable')).toBeOnTheScreen();
      expect(lastSearch(shop)?.get('lat')).toBeNull();
    });
  });

  describe('paging', () => {
    function pagedShop() {
      const shop = createFakeShop();
      shop.on('GET', '/v1/public/events', (call) =>
        call.query.get('cursor') === 'c1'
          ? json(200, { data: [summary(3)], nextCursor: null })
          : json(200, { data: [summary(1), summary(2)], nextCursor: 'c1' }),
      );
      return shop;
    }

    it('continues from the API’s cursor and says when there is no more', async () => {
      const shop = pagedShop();
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      expect(screen.queryByTestId('event-event-3')).toBeNull();
      fireEvent.press(screen.getByTestId('show-more'));
      expect(await screen.findByTestId('event-event-3')).toBeOnTheScreen();
      expect(searches(shop).at(-1)?.query.get('cursor')).toBe('c1');
      expect(screen.queryByTestId('show-more')).toBeNull();
      expect(screen.getByText(t('en', 'discover.endOfResults'))).toBeOnTheScreen();
    });

    it('loads the next page on its own when the list reaches the end', async () => {
      const shop = pagedShop();
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      await act(async () => {
        screen.getByTestId('discover-list').props.onEndReached?.();
      });
      expect(await screen.findByTestId('event-event-3')).toBeOnTheScreen();
    });

    it('starts again from the first page when a filter changes', async () => {
      const shop = pagedShop();
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      fireEvent.press(screen.getByTestId('show-more'));
      await screen.findByTestId('event-event-3');
      fireEvent.press(screen.getByTestId('category-music'));
      await waitFor(() => expect(screen.queryByTestId('event-event-3')).toBeNull());
      expect(lastSearch(shop)?.get('cursor')).toBeNull();
    });

    it('pull to refresh reads the first page again', async () => {
      const shop = createFakeShop();
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      const before = searches(shop).length;
      await act(async () => {
        screen.getByTestId('discover-list').props.refreshControl.props.onRefresh();
      });
      await waitFor(() => expect(searches(shop).length).toBeGreaterThan(before));
    });
  });

  describe('empty, loading and error states', () => {
    it('shows loading first', async () => {
      const shop = createFakeShop();
      shop.on('GET', '/v1/public/events', () => new Promise<Response>(() => {}));
      await renderApp(<DiscoverScreen />, { shop });
      expect(await screen.findByLabelText(t('en', 'discover.loading'))).toBeOnTheScreen();
    });

    it('says nothing is on yet when there are no events and no filters', async () => {
      const shop = createFakeShop();
      shop.on('GET', '/v1/public/events', () => json(200, { data: [], nextCursor: null }));
      await renderApp(<DiscoverScreen />, { shop });
      expect(await screen.findByText(t('en', 'discover.emptyNoFiltersTitle'))).toBeOnTheScreen();
    });

    it('with filters set, suggests other words and clears them', async () => {
      const shop = createFakeShop();
      shop.on('GET', '/v1/public/events', (call) =>
        json(200, { data: call.query.get('category') ? [] : [summary(1)], nextCursor: null }),
      );
      await renderApp(<DiscoverScreen />, { shop });
      await screen.findByTestId('event-event-1');
      fireEvent.press(screen.getByTestId('category-nightlife'));
      expect(await screen.findByText(t('en', 'discover.emptyTitle'))).toBeOnTheScreen();
      expect(screen.getByText(t('en', 'discover.emptyBody'))).toBeOnTheScreen();
      fireEvent.press(screen.getAllByTestId('clear-filters')[0] as never);
      expect(await screen.findByTestId('event-event-1')).toBeOnTheScreen();
      expect(lastSearch(shop)?.get('category')).toBeNull();
    });

    it('no connection: says so and retries', async () => {
      const shop = createFakeShop();
      let offline = true;
      shop.on('GET', '/v1/public/events', () => {
        if (offline) throw new TypeError('Network request failed');
        return json(200, { data: [summary(1)], nextCursor: null });
      });
      await renderApp(<DiscoverScreen />, { shop });
      const error = await screen.findByTestId('search-error');
      expect(error).toHaveTextContent(t('en', 'core.errors.network'), { exact: false });
      offline = false;
      fireEvent.press(screen.getByRole('button', { name: t('en', 'core.common.retry') }));
      expect(await screen.findByTestId('event-event-1')).toBeOnTheScreen();
    });

    it('a server error and a rate limit each have their own message', async () => {
      const shop = createFakeShop();
      shop.on('GET', '/v1/public/events', () => problem(500, 'internal'));
      await renderApp(<DiscoverScreen />, { shop });
      expect(await screen.findByTestId('search-error')).toHaveTextContent(t('en', 'core.errors.generic'), { exact: false });
      const limited = createFakeShop();
      limited.on('GET', '/v1/public/events', () => problem(429, 'rate_limited', {}, { 'retry-after': '30' }));
      await renderApp(<DiscoverScreen />, { shop: limited });
      expect(await screen.findAllByText(t('en', 'discover.rateLimited'))).not.toHaveLength(0);
    });
  });

  describe('languages', () => {
    it('writes prices in the person’s language and currency', async () => {
      await renderApp(<DiscoverScreen />, { locale: 'de' });
      const card = await screen.findByTestId('event-event-1');
      const price = formatPriceRange(2500, 9000, 'EUR', 'de', t('de', 'discover.free'));
      expect(price).toBe('25,00 € – 90,00 €');
      expect(within(card).getByText(t('de', 'discover.priceFrom').replace('{price}', price ?? ''))).toBeOnTheScreen();
    });

    it('Arabic reads right to left with the controls labelled in Arabic', async () => {
      await renderApp(<DiscoverScreen />, { locale: 'ar' });
      await waitFor(() => expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' }));
      expect(await screen.findByRole('header', { name: t('ar', 'discover.title') })).toBeOnTheScreen();
      expect(screen.getByLabelText(t('ar', 'discover.searchLabel'))).toBeOnTheScreen();
      expect(screen.getByTestId('near-me').props.accessibilityLabel).toBe(t('ar', 'discover.nearMe'));
      expect(screen.getByTestId('category-music').props.accessibilityLabel).toBe(t('ar', 'discover.categories.music'));
      await screen.findByTestId('event-event-1');
      expect(screen.getByTestId('event-event-1').props.accessibilityHint).toBe(t('ar', 'discover.openEvent'));
    });

    it('every control has a role and a label, and touch targets are at least 44 points', async () => {
      await renderApp(<DiscoverScreen />);
      await screen.findByTestId('event-event-1');
      for (const id of ['near-me', 'when-any', 'when-today', 'when-custom', 'category-all']) {
        const node = screen.getByTestId(id);
        expect(node.props.accessibilityRole).toBe('button');
        expect(node.props.accessibilityLabel).toBeTruthy();
        const style = Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
        expect(style.minHeight).toBeGreaterThanOrEqual(44);
      }
    });
  });
});
