import type { Planter } from '../types.ts';

/**
 * notifications: an email to the person (with a bounce report quoting the address), a failed text
 * to their number, a staff notification about their order, their unsubscribe, bounce and STOP
 * suppressions, a browser push device, a staff inbox item and an email preview naming them.
 */
export const plantNotifications: Planter = async ({ admin, orgId, eventId, ownerId, person, ids }) => {
  if (!ids.orderId || !ids.contactId)
    throw new Error('plantNotifications: run plantCrm and plantOrders first');
  const [mail] = await admin`
    insert into notifications.messages (org_id, kind, category, channel, dedupe_key, status, recipient_email,
      recipient_name, params_ciphertext, subject, contact_id, order_id, event_id, sent_at, delivery)
    values (${orgId}, 'orders.event_reminder', 'reminders', 'email', ${`event-reminder:${eventId}:${person.email}`}, 'sent',
      ${person.email}, ${person.name}, 'planted', ${`See you soon, ${person.name}`}, ${ids.contactId}, ${ids.orderId},
      ${eventId}, now(), 'bounced')
    returning id`;
  await admin`
    insert into notifications.message_events (org_id, message_id, provider, provider_event_id, type, bounce_type, detail, occurred_at)
    values (${orgId}, ${mail?.id as string}, 'fake', ${`dsar-${mail?.id as string}`}, 'bounced', 'hard',
      ${`550 5.1.1 <${person.email}>: user unknown`}, now())`;
  await admin`
    insert into notifications.messages (org_id, kind, category, channel, dedupe_key, status, recipient_name,
      params_ciphertext, contact_id, order_id, event_id, last_error)
    values (${orgId}, 'orders.event_reminder', 'reminders', 'sms', ${`dsar-sms:${ids.contactId}`}, 'failed', ${person.name},
      'planted', ${ids.contactId}, ${ids.orderId}, ${eventId}, ${`21211 invalid number ${person.phone}`})`;
  await admin`
    insert into notifications.messages (org_id, kind, category, channel, dedupe_key, status, recipient_user_id,
      params_ciphertext, subject, order_id, event_id, sent_at)
    values (${orgId}, 'orders.refund_requested', 'transactional', 'email', ${`dsar-staff:${ids.orderId}:${ownerId}`}, 'sent',
      ${ownerId}, 'planted', ${`Refund requested by ${person.name}`}, ${ids.orderId}, ${eventId}, now())`;
  await admin`
    insert into notifications.suppressions (org_id, email_norm, category, source)
    values (${orgId}, ${person.email}, 'marketing', 'page')`;
  await admin`
    insert into notifications.address_suppressions (org_id, channel, address_norm, reason)
    values (${orgId}, 'email', ${person.email}, 'hard_bounce'), (${orgId}, 'sms', ${person.phone}, 'opt_out')`;
  await admin`
    insert into notifications.push_tokens (org_id, email_norm, platform, token, source)
    values (${orgId}, ${person.email}, 'fcm', ${`fcm-dsar-${ids.contactId}`}, 'web')`;
  await admin`
    insert into notifications.inbox_items (org_id, user_id, kind, params, dedupe_key, order_id, event_id)
    values (${orgId}, ${ownerId}, 'orders.refund_requested', ${JSON.stringify({ buyer: person.name })}::jsonb,
      ${`dsar-inbox:${ids.orderId}`}, ${ids.orderId}, ${eventId})`;
  await admin`
    insert into notifications.email_previews (org_id, created_by, html, expires_at)
    values (${orgId}, ${ownerId}, ${`<p>Dear ${person.name},</p><p>your tickets are attached.</p>`}, now() + interval '10 minutes')`;
  return [
    'notifications.messages',
    'notifications.message_events',
    'notifications.suppressions',
    'notifications.address_suppressions',
    'notifications.push_tokens',
    'notifications.inbox_items',
    'notifications.email_previews',
  ];
};
