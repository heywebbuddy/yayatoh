'use strict';

const { idempotencyKey, orgUrl } = require('../lib/api');

const EVENT = {
  key: 'eventId',
  label: 'Event',
  required: true,
  dynamic: 'event_list.id.name',
  helpText: 'Pick the event, or give its id.',
};

/** Create registration: put someone on an event's guest list (scope `attendees:write`). */
const createRegistration = {
  key: 'create_registration',
  noun: 'Registration',
  display: {
    label: 'Create Registration',
    description: 'Adds a person to an event’s guest list (no ticket, no payment).',
  },
  operation: {
    inputFields: [
      EVENT,
      { key: 'name', label: 'Name', required: true },
      { key: 'email', label: 'Email', required: true },
      { key: 'labels', label: 'Labels', list: true, required: false, helpText: 'Up to 10 short labels.' },
    ],
    perform: async (z, bundle) => {
      const { eventId, name, email, labels } = bundle.inputData;
      const response = await z.request({
        method: 'POST',
        url: orgUrl(bundle, `/events/${encodeURIComponent(eventId)}/registrations`),
        headers: { 'Idempotency-Key': idempotencyKey('create_registration', bundle) },
        body: { name, email, ...(labels?.length ? { labels } : {}) },
      });
      return response.data;
    },
    sample: {
      id: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a90',
      eventId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a82',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      source: 'guest',
      status: 'active',
      ticketId: null,
      labels: ['zapier'],
      createdAt: '2030-03-01T23:04:11.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Registration ID' },
      { key: 'eventId', label: 'Event ID' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'status', label: 'Status' },
      { key: 'createdAt', label: 'Created at', type: 'datetime' },
    ],
  },
};

/** Add contact: find or create the org's contact for an email (scope `contacts:write`). */
const addContact = {
  key: 'add_contact',
  noun: 'Contact',
  display: {
    label: 'Add Contact',
    description: 'Adds a contact to your Yayatoh contacts (an existing email is found, never duplicated).',
  },
  operation: {
    inputFields: [
      { key: 'email', label: 'Email', required: true },
      { key: 'name', label: 'Name', required: false },
    ],
    perform: async (z, bundle) => {
      const { email, name } = bundle.inputData;
      const response = await z.request({
        method: 'POST',
        url: orgUrl(bundle, '/contacts'),
        headers: { 'Idempotency-Key': idempotencyKey('add_contact', bundle) },
        body: { email, ...(name ? { name } : {}) },
      });
      return response.data;
    },
    sample: { id: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a91', created: true },
    outputFields: [
      { key: 'id', label: 'Contact ID' },
      { key: 'created', label: 'Created (false: already a contact)', type: 'boolean' },
    ],
  },
};

/** Check in: scan a ticket's QR payload or short code for an event (scope `checkin:scan`). */
const checkIn = {
  key: 'check_in',
  noun: 'Check-in',
  display: {
    label: 'Check In Ticket',
    description: 'Checks a ticket in by its QR payload or printed short code, and returns the door verdict.',
  },
  operation: {
    inputFields: [
      EVENT,
      { key: 'code', label: 'Ticket code', required: true, helpText: 'The QR payload or short code.' },
    ],
    perform: async (z, bundle) => {
      const { eventId, code } = bundle.inputData;
      const response = await z.request({
        method: 'POST',
        url: orgUrl(bundle, `/events/${encodeURIComponent(eventId)}/checkins`),
        headers: { 'Idempotency-Key': idempotencyKey('check_in', bundle) },
        body: { code },
      });
      return response.data;
    },
    sample: {
      result: 'admitted',
      ticket: {
        holderName: 'Ada Lovelace',
        typeName: 'General admission',
        serial: 1,
        shortCode: 'K7Q2-9XZD',
      },
      admissionId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a84',
      firstAdmittedAt: null,
    },
    outputFields: [
      { key: 'result', label: 'Result' },
      { key: 'ticket__holderName', label: 'Holder name' },
      { key: 'ticket__typeName', label: 'Ticket type' },
      { key: 'admissionId', label: 'Admission ID' },
      { key: 'firstAdmittedAt', label: 'First admitted at', type: 'datetime' },
    ],
  },
};

module.exports = [createRegistration, addContact, checkIn];
