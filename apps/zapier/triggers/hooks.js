'use strict';

const { flatten, idempotencyKey, orgUrl } = require('../lib/api');

const ID = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a80';
const EVENT_ID = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a82';
const AT = '2030-03-01T23:04:11.000Z';

/**
 * A REST-hook trigger for one public event type (M6.4c). Subscribing registers Zapier's target
 * URL with Yayatoh (`POST /v1/orgs/{org}/hooks`, scope `webhooks:subscribe`); turning the Zap off
 * unsubscribes it. Deliveries are Yayatoh's thin webhook messages (ids and facts, never personal
 * data): look details up with an action or the API.
 */
const hookTrigger = ({ key, event, noun, label, description, data, fields }) => ({
  key,
  noun,
  display: { label, description },
  operation: {
    type: 'hook',
    performSubscribe: async (z, bundle) => {
      const response = await z.request({
        method: 'POST',
        url: orgUrl(bundle, '/hooks'),
        headers: {
          'Idempotency-Key': idempotencyKey(`subscribe:${event}`, { inputData: { url: bundle.targetUrl } }),
        },
        body: { url: bundle.targetUrl, event },
      });
      return response.data;
    },
    performUnsubscribe: async (z, bundle) => {
      await z.request({
        method: 'DELETE',
        url: orgUrl(bundle, `/hooks/${encodeURIComponent(bundle.subscribeData.id)}`),
      });
      return {};
    },
    perform: (_z, bundle) => [flatten(bundle.cleanedRequest)],
    performList: async (z, bundle) => {
      const response = await z.request({ url: orgUrl(bundle, '/hooks/samples'), params: { event } });
      return (response.data.data || []).map(flatten);
    },
    sample: { id: ID, type: event, occurredAt: AT, ...data },
    outputFields: [
      { key: 'id', label: 'Message ID' },
      { key: 'type', label: 'Event type' },
      { key: 'occurredAt', label: 'Occurred at', type: 'datetime' },
      ...fields,
    ],
  },
});

module.exports = [
  hookTrigger({
    key: 'order_paid',
    event: 'order.paid',
    noun: 'Order',
    label: 'Order Paid',
    description: 'Triggers when an order is paid (online, at the box office or by invoice).',
    data: {
      orderId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a81',
      eventId: EVENT_ID,
      totalMinor: 5000,
      currency: 'USD',
      via: 'stripe',
    },
    fields: [
      { key: 'orderId', label: 'Order ID' },
      { key: 'eventId', label: 'Event ID' },
      { key: 'totalMinor', label: 'Total (minor units)', type: 'integer' },
      { key: 'currency', label: 'Currency' },
      { key: 'via', label: 'Paid via' },
    ],
  }),
  hookTrigger({
    key: 'ticket_admitted',
    event: 'ticket.admitted',
    noun: 'Check-in',
    label: 'Ticket Checked In',
    description: 'Triggers when a ticket is admitted at the door.',
    data: {
      eventId: EVENT_ID,
      ticketId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a83',
      admissionId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a84',
      day: '2030-03-01',
      admittedAt: AT,
    },
    fields: [
      { key: 'eventId', label: 'Event ID' },
      { key: 'ticketId', label: 'Ticket ID' },
      { key: 'admissionId', label: 'Admission ID' },
      { key: 'day', label: 'Event day' },
      { key: 'admittedAt', label: 'Admitted at', type: 'datetime' },
    ],
  }),
  hookTrigger({
    key: 'registration_submitted',
    event: 'form.registration_submitted',
    noun: 'Registration',
    label: 'Registration Form Submitted',
    description: 'Triggers when someone submits an event’s registration form.',
    data: {
      respondentId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a84',
      eventId: EVENT_ID,
      registrationTypeId: 'vip',
      formVersion: 3,
    },
    fields: [
      { key: 'respondentId', label: 'Respondent ID' },
      { key: 'eventId', label: 'Event ID' },
      { key: 'registrationTypeId', label: 'Registration type' },
      { key: 'formVersion', label: 'Form version', type: 'integer' },
    ],
  }),
  hookTrigger({
    key: 'event_published',
    event: 'event.published',
    noun: 'Event',
    label: 'Event Published',
    description: 'Triggers when an event goes on sale (is published).',
    data: { eventId: EVENT_ID, from: 'draft', to: 'published' },
    fields: [
      { key: 'eventId', label: 'Event ID' },
      { key: 'from', label: 'From status' },
      { key: 'to', label: 'To status' },
    ],
  }),
];
