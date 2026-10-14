import { initSentry, isValidDsn, reportError, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl, sentryEnabled } from '../src/platform/sentry';

describe('scrubText', () => {
  it.each([
    ['Failed for ada@example.test', 'Failed for [email]'],
    ['Authorization: Bearer abc.DEF-123_xyz', 'Authorization: Bearer [token]'],
    ['refresh yyr_AbCdEf1234567890 spent', 'refresh [token] spent'],
    ['device yyd_abcdef123456', 'device [token]'],
    ['key yy_live_AbC12345678', 'key [token]'],
    ['eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', '[jwt]'],
    ['hash 0123456789abcdef0123456789abcdef0123', 'hash [hex]'],
    ['call +1 (415) 555-0123 now', 'call [phone] now'],
    ['call 020 7946 0958', 'call [phone]'],
  ])('%s', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it('leaves ordinary text, version numbers and short numbers alone', () => {
    expect(scrubText('Render failed in TicketList (v1.4.2) after 3 retries')).toBe(
      'Render failed in TicketList (v1.4.2) after 3 retries',
    );
  });
});

describe('scrubUrl', () => {
  it('drops the query, the fragment and credentials, and masks identifier-like segments', () => {
    expect(scrubUrl('https://user:pw@app.yayatoh.com/api/v1/tickets/3f2b8c1e-5d4a-4e6b-9a7c-0d1e2f3a4b5c?token=secret#frag')).toBe(
      'https://app.yayatoh.com/api/v1/tickets/:id',
    );
    expect(scrubUrl('https://yayatoh.com/claim/AbCdEf123456_-tokenXYZ')).toBe('https://yayatoh.com/claim/:id');
    expect(scrubUrl('https://yayatoh.com/scan#e=1&k=SECRETKEY123456')).toBe('https://yayatoh.com/scan');
    expect(scrubUrl('yayatoh-staff://scan#e=1&k=SECRETKEY123456')).toBe('yayatoh-staff://scan');
  });
});

describe('scrubEvent', () => {
  const event = {
    event_id: 'e1',
    level: 'error',
    user: { id: 'u1', email: 'ada@example.test', ip_address: '1.2.3.4' },
    server_name: 'Ada’s iPhone',
    message: 'Sign-in failed for ada@example.test',
    request: {
      method: 'POST',
      url: 'https://app.yayatoh.com/api/v1/auth/token?x=1',
      headers: { Authorization: 'Bearer abc.def' },
      cookies: { a: 'b' },
      data: { password: 'hunter2', email: 'ada@example.test' },
      query_string: 'x=1',
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Cannot read yyr_AbCdEf1234567890 of ada@example.test',
          stacktrace: { frames: [{ filename: 'app:///index.bundle', function: 'signIn', lineno: 10 }] },
        },
      ],
    },
    contexts: { device: { name: 'Ada’s iPhone', model: 'iPhone15,2', geo: { city: 'London' } }, os: { name: 'iOS', version: '19.0' } },
    tags: { screen: 'tickets', email: 'ada@example.test', ticketCode: 'XYZ' },
    extra: { note: 'call +44 20 7946 0958', password: 'x' },
    breadcrumbs: [
      { category: 'fetch', message: 'GET ada@example.test', data: { url: 'https://app.yayatoh.com/api/v1/me/tickets/3f2b8c1e-5d4a-4e6b-9a7c-0d1e2f3a4b5c?x=1', status_code: 200, request_body: 'secret' } },
    ],
  };

  it('removes the person, the request’s data and every identifier', () => {
    const out = scrubEvent(event) as typeof event & Record<string, unknown>;
    const all = JSON.stringify(out);
    for (const secret of ['ada@example.test', 'hunter2', 'abc.def', 'yyr_AbCdEf', '1.2.3.4', 'Ada’s iPhone', '3f2b8c1e', '+44 20', 'London', 'secret', 'XYZ'])
      expect(all).not.toContain(secret);
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.request).toEqual({ method: 'POST', url: 'https://app.yayatoh.com/api/v1/auth/token' });
  });

  it('keeps what is needed to debug a crash: the error, the stack, the model and OS, the route', () => {
    const out = scrubEvent(event) as typeof event;
    expect(out.exception.values[0]?.type).toBe('Error');
    expect(out.exception.values[0]?.stacktrace.frames[0]).toEqual({ filename: 'app:///index.bundle', function: 'signIn', lineno: 10 });
    expect(out.contexts.device).toEqual({ model: 'iPhone15,2' });
    expect(out.contexts.os).toEqual({ name: 'iOS', version: '19.0' });
    expect(out.tags.screen).toBe('tickets');
    expect(out.breadcrumbs[0]?.data).toEqual({ url: 'https://app.yayatoh.com/api/v1/me/tickets/:id', status_code: 200 });
  });

  it('does not change the event it was given', () => {
    const before = JSON.stringify(event);
    scrubEvent(event);
    expect(JSON.stringify(event)).toBe(before);
  });

  it('scrubs a breadcrumb on its own', () => {
    expect(scrubBreadcrumb({ message: 'user ada@example.test tapped', data: { url: 'https://x.test/a/b?q=1', extra: 'leak' } })).toEqual({
      message: 'user [email] tapped',
      data: { url: 'https://x.test/a/b' },
    });
  });
});

describe('initSentry', () => {
  it('stays off without a DSN, with an empty one or with a malformed one', () => {
    const init = jest.fn();
    for (const dsn of [undefined, null, '', '   ', 'http://key@o1.ingest.sentry.io/1', 'not a dsn', 'https://o1.ingest.sentry.io/1']) {
      expect(initSentry({ dsn, environment: 'production' }, { init })).toBe(false);
    }
    expect(init).not.toHaveBeenCalled();
    expect(sentryEnabled()).toBe(false);
  });

  it('starts with PII off, no screenshots and the scrubbers installed', () => {
    const init = jest.fn();
    const dsn = 'https://abc123@o1.ingest.sentry.io/42';
    expect(isValidDsn(dsn)).toBe(true);
    expect(initSentry({ dsn: ` ${dsn} `, environment: 'preview', release: 'yayatoh-ios@1.0.0+1' }, { init })).toBe(true);
    const options = init.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      dsn,
      environment: 'preview',
      release: 'yayatoh-ios@1.0.0+1',
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      tracesSampleRate: 0,
    });
    const sent = options.beforeSend({ user: { email: 'a@b.test' }, message: 'x a@b.test' });
    expect(sent.user).toBeUndefined();
    expect(sent.message).toBe('x [email]');
    expect(options.beforeBreadcrumb({ message: 'a@b.test' }).message).toBe('[email]');
    expect(sentryEnabled()).toBe(true);
  });

  it('reportError sends only while on, and masks a non-Error value', () => {
    const capture = jest.fn();
    initSentry({ dsn: undefined, environment: 'development' }, { init: jest.fn() });
    reportError(new Error('x'), { captureException: capture });
    expect(capture).not.toHaveBeenCalled();

    initSentry({ dsn: 'https://abc123@o1.ingest.sentry.io/42', environment: 'production' }, { init: jest.fn() });
    reportError(new Error('boom'), { captureException: capture });
    reportError('failed for ada@example.test', { captureException: capture });
    expect(capture).toHaveBeenCalledTimes(2);
    expect((capture.mock.calls[1]?.[0] as Error).message).toBe('failed for [email]');
    initSentry({ dsn: undefined, environment: 'development' }, { init: jest.fn() });
  });
});
