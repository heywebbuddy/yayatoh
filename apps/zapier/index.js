'use strict';

const authentication = require('./authentication');
const hookTriggers = require('./triggers/hooks');
const eventList = require('./triggers/event-list');
const actions = require('./creates/actions');

/**
 * Yayatoh for Zapier (M6.4c). Zapier Platform CLI format; not published (publishing waits for the
 * owner's Zapier partner review, docs/owner-inbox.md). Triggers are REST hooks on Yayatoh's
 * webhooks; actions call /v1. Authentication is an org API key with scopes.
 */

const addAuth = (request, _z, bundle) => {
  if (bundle.authData?.apiKey) request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  request.headers.Accept = 'application/json';
  return request;
};

/** Yayatoh answers errors as problem+json: show its title and stable code, never a raw body. */
const handleErrors = (response, z) => {
  if (response.status < 400) return response;
  let problem = {};
  try {
    problem = JSON.parse(response.content || '{}');
  } catch {
    problem = {};
  }
  const code = typeof problem.code === 'string' ? problem.code : `http_${response.status}`;
  const title = typeof problem.title === 'string' ? problem.title : 'The request failed';
  const detail = typeof problem.detail === 'string' ? `: ${problem.detail}` : '';
  if (response.status === 401)
    throw new z.errors.Error(
      'The API key is unknown, expired or revoked. Reconnect with a live key.',
      'AuthenticationError',
      401,
    );
  if (response.status === 403)
    throw new z.errors.Error(
      `The API key is missing a scope for this (${code}). Settings → Integrations → Zapier lists the scopes.`,
      'ForbiddenError',
      403,
    );
  if (response.status === 429) throw new z.errors.ThrottledError('Yayatoh rate limit reached', 60);
  throw new z.errors.Error(`${title}${detail}`, code, response.status);
};

const byKey = (list) => Object.fromEntries(list.map((x) => [x.key, x]));

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  beforeRequest: [addAuth],
  afterResponse: [handleErrors],
  triggers: byKey([...hookTriggers, eventList]),
  creates: byKey(actions),
};
