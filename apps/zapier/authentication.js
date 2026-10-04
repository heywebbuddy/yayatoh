'use strict';

const { orgUrl } = require('./lib/api');

/**
 * Authentication: an org API key (Settings → API keys in Yayatoh) and the org it belongs to. The
 * key's scopes are the whole grant: Settings → Integrations → Zapier lists the ones each trigger
 * and action needs. The test call reads the key itself (`GET /v1/orgs/{org}/api-key`), so a
 * revoked, expired or other-org key fails here.
 */
module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'org',
      label: 'Organization',
      required: true,
      type: 'string',
      helpText: 'Your organization’s id or its short name: the part after `/o/` in your Yayatoh address.',
    },
    {
      key: 'apiKey',
      label: 'API key',
      required: true,
      type: 'password',
      helpText:
        'A live key (`yy_live_…`) from Settings → API keys. Settings → Integrations → Zapier lists the scopes it needs.',
    },
  ],
  test: async (z, bundle) => {
    const response = await z.request({ url: orgUrl(bundle, '/api-key') });
    return response.data;
  },
  connectionLabel: (_z, bundle) => `${bundle.inputData.name} (${bundle.authData.org})`,
};
