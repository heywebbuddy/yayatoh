'use strict';

const { orgUrl } = require('../lib/api');

/**
 * The event picker behind the actions (hidden): the org's first 100 events (scope `events:read`).
 * An event not in the list can be given by its id as a custom value.
 */
module.exports = {
  key: 'event_list',
  noun: 'Event',
  display: {
    label: 'List Events',
    description: 'The organization’s events (for picking one).',
    hidden: true,
  },
  operation: {
    perform: async (z, bundle) => {
      const response = await z.request({ url: orgUrl(bundle, '/events'), params: { limit: '100' } });
      return (response.data.data || []).map((e) => ({
        id: e.id,
        name: e.name,
        slug: e.slug,
        status: e.status,
        startsAt: e.startsAt,
        timezone: e.timezone,
      }));
    },
    sample: {
      id: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a82',
      name: 'Spring Gala',
      slug: 'spring-gala',
      status: 'published',
      startsAt: '2030-03-01T23:00:00.000Z',
      timezone: 'America/Chicago',
    },
    outputFields: [
      { key: 'id', label: 'Event ID' },
      { key: 'name', label: 'Name' },
      { key: 'slug', label: 'Slug' },
      { key: 'status', label: 'Status' },
      { key: 'startsAt', label: 'Starts at', type: 'datetime' },
      { key: 'timezone', label: 'Time zone' },
    ],
  },
};
