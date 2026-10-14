import { outcomeOfUrl, parseCheckoutReturn } from '../../src/shop/event-links';
import { brandColorOf, mapLinkFor, plainText, safeHttpsUrl } from '../../src/shop/text';

const ORDER = '0b9e5a5c-6f0d-4c43-9d57-0d5f3b7d2a11';

describe('return links', () => {
  it('reads the two markers of the checkout’s return and cancel links', () => {
    expect(parseCheckoutReturn('return', ORDER)).toEqual({ outcome: 'return', orderId: ORDER });
    expect(parseCheckoutReturn('cancelled', ORDER)).toEqual({ outcome: 'cancelled', orderId: ORDER });
    expect(parseCheckoutReturn(['return'], [ORDER])).toEqual({ outcome: 'return', orderId: ORDER });
  });

  it('ignores anything else, and an order that is not an id', () => {
    expect(parseCheckoutReturn(undefined, ORDER)).toBeNull();
    expect(parseCheckoutReturn('paid', ORDER)).toBeNull();
    expect(parseCheckoutReturn('return', '../etc')).toEqual({ outcome: 'return', orderId: null });
    expect(parseCheckoutReturn('return', undefined)).toEqual({ outcome: 'return', orderId: null });
  });

  it('reads the URL a browser session ended on', () => {
    expect(outcomeOfUrl(`https://app.yayatoh.com/events/summit?checkout=return&order=${ORDER}`)).toEqual({
      outcome: 'return',
      orderId: ORDER,
    });
    expect(outcomeOfUrl(`https://app.yayatoh.com/events/summit?order=${ORDER}&checkout=cancelled#x`)).toEqual(
      {
        outcome: 'cancelled',
        orderId: ORDER,
      },
    );
    expect(outcomeOfUrl('https://app.yayatoh.com/events/summit')).toBeNull();
  });
});

describe('text from the API is untrusted', () => {
  it('strips Markdown and HTML to plain text', () => {
    expect(
      plainText(
        '# Welcome\n\nJoin **us** at [the hall](https://x.test).\n\n- one\n- two\n\n<script>alert(1)</script>![i](https://x.test/a.png)',
      ),
    ).toBe('Welcome\n\nJoin us at the hall.\n\n• one\n• two\n\nalert(1)');
  });

  it('opens https links only', () => {
    expect(safeHttpsUrl('https://maps.example.test/?q=1')).toBe('https://maps.example.test/?q=1');
    expect(safeHttpsUrl('http://maps.example.test')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('tel:+123')).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
    expect(safeHttpsUrl('not a url')).toBeNull();
  });

  it('links the map by the venue’s own link, else its coordinates, else its address', () => {
    const base = {
      mapUrl: null,
      latitude: null,
      longitude: null,
      name: 'City Hall',
      addressLine1: '1 Main St',
      city: 'Lisbon',
    };
    expect(mapLinkFor({ ...base, mapUrl: 'https://maps.example.test/hall' })).toBe(
      'https://maps.example.test/hall',
    );
    expect(mapLinkFor({ ...base, mapUrl: 'javascript:x', latitude: 38.7, longitude: -9.1 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=38.7,-9.1',
    );
    expect(mapLinkFor(base)).toBe(
      'https://www.google.com/maps/search/?api=1&query=City%20Hall%2C%201%20Main%20St%2C%20Lisbon',
    );
  });

  it('takes a brand colour only as an opaque hex colour', () => {
    expect(brandColorOf({ brandColor: '#1A2B3C' })).toBe('#1A2B3C');
    expect(brandColorOf({ brandColor: 'red' })).toBeNull();
    expect(brandColorOf({ brandColor: 'url(javascript:1)' })).toBeNull();
    expect(brandColorOf({})).toBeNull();
    expect(brandColorOf(null)).toBeNull();
  });
});
