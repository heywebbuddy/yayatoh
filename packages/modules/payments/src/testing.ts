import Stripe from 'stripe';
import { STRIPE_API_VERSION } from './stripe.ts';

export { providerEvents } from './schema.ts';

/** One request the fake Stripe API received. */
export interface StripeCall {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: URLSearchParams;
  /** A JSON body (Stripe's v2 APIs, e.g. Accounts v2), parsed; null for form bodies. */
  readonly json: unknown;
  /** The `Stripe-Account` header (a connected account), or null for the platform account. */
  readonly account: string | null;
  readonly idempotencyKey: string | null;
}

export type StripeRoute = (c: StripeCall) => { status?: number; json: unknown };

/**
 * A fake Stripe API for tests (no network): `fetch` records every request and answers it from
 * `routes` ("POST /v1/refunds" → JSON); unknown routes answer 404 like Stripe does.
 */
export function fakeStripeApi(routes: Record<string, StripeRoute>) {
  const calls: StripeCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const call: StripeCall = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
      json: (() => {
        try {
          return typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null;
        } catch {
          return null;
        }
      })(),
      account: headers.get('stripe-account'),
      idempotencyKey: headers.get('idempotency-key'),
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    const out = route
      ? route(call)
      : {
          status: 404,
          json: {
            error: { type: 'invalid_request_error', message: `No such route: ${call.method} ${call.path}` },
          },
        };
    return new Response(JSON.stringify(out.json), {
      status: out.status ?? 200,
      headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
    });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

const signer = new Stripe('sk_test_signer', { apiVersion: STRIPE_API_VERSION });

/** A Stripe event body and its `Stripe-Signature` header, signed with `secret` (tests). */
export async function signStripeEvent(event: Record<string, unknown>, secret: string) {
  const payload = JSON.stringify({ object: 'event', api_version: STRIPE_API_VERSION, created: 1, ...event });
  const header = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret });
  return { payload, headers: new Headers({ 'stripe-signature': header }) };
}
