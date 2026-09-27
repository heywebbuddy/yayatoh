import type { Rules } from './mask.ts';

/**
 * Masking rules for the legacy Laravel/Eventmie databases (yayatoh.com and abc.yayatoh.com),
 * from the legacy migrations (column inventory in the M2.2 spec). Columns not listed here fall
 * back to the name heuristics in mask.ts; anything else is kept (event content, amounts, dates,
 * statuses and ids, which the migration needs as they are).
 *
 * Kept on purpose: public event content (titles, descriptions, venues, speakers, performer
 * profiles, CMS pages), because it is already published and the migration must reproduce it.
 */
export const LEGACY_RULES: Rules = {
  // Rows that are never migrated and hold live credentials, card data or queued mail.
  sessions: { dropRows: true },
  password_resets: { dropRows: true },
  otps: { dropRows: true },
  cache: { dropRows: true },
  cache_locks: { dropRows: true },
  jobs: { dropRows: true },
  job_batches: { dropRows: true },
  failed_jobs: { dropRows: true },
  webhook_test: { dropRows: true },

  users: {
    columns: {
      name: 'fullName',
      first_name: 'firstName',
      last_name: 'lastName',
      location: 'street',
      bio: 'text',
      social_links: 'jsonAll',
      email: 'email',
      apple_id: 'token',
      password: 'password',
      remember_token: 'token',
      magic_login_token: 'token',
      fcm_token: 'token',
      apn_token: 'token',
      stripe_id: 'reference',
      pm_last_four: 'last4',
      avatar: 'image',
      bank_name: 'null',
      bank_code: 'null',
      bank_branch_name: 'null',
      bank_branch_code: 'null',
      bank_account_number: 'null',
      bank_account_name: 'null',
      bank_account_phone: 'null',
      address: 'street',
      phone: 'phone',
      mailchimp_apikey: 'token',
      mailchimp_list_id: 'token',
      stripe_account_id: 'reference',
      taxpayer_number: 'null',
      seller_name: 'fullName',
      seller_info: 'text',
      seller_tax_info: 'null',
      seller_signature: 'image',
      seller_note: 'text',
      pincode: 'postcode',
      ip_address: 'ip',
    },
  },
  personal_access_tokens: { columns: { token: 'token' } },
  subscriptions: { columns: { stripe_id: 'reference' } },
  subscription_items: { columns: { stripe_id: 'reference' } },

  bookings: { columns: { customer_name: 'fullName', customer_email: 'email' } },
  transactions: { columns: { txn_id: 'reference', payer_reference: 'emailOrReference' } },
  failed_bookings: {
    columns: {
      orderId: 'reference',
      pre_payment: 'jsonAll',
      booking: 'json',
      // Raw card numbers and CVCs (legacy defect): nothing of it may leave the server.
      payment_method: 'emptyJson',
      selected_attendees: 'jsonAll',
      razorpay_order_id: 'reference',
      razorpay_data: 'emptyJson',
    },
  },
  // `attendees.address` holds the attendee's email in the legacy code.
  attendees: { columns: { name: 'fullName', phone: 'phone', address: 'contact' } },
  events: {
    columns: {
      // Wi-Fi passwords, parking and door codes, organizer contacts.
      private_info: 'jsonAll',
      online_location: 'text',
      offline_payment_info: 'text',
      event_password: 'token',
    },
  },
  event_exhibitors: { columns: { staff: 'jsonAll', email: 'email', phone: 'phone' } },
  guests: { columns: { name: 'fullName', email: 'email' } },
  newsletter_subscribers: { columns: { name: 'fullName', email: 'email', phone: 'phone', ip_address: 'ip' } },
  // The mail arrays of sent notifications, including generated guest passwords in plain text.
  notifications: { columns: { data: 'jsonAll' } },
  contacts: { columns: { name: 'fullName', email: 'email', message: 'text' } },
  reviews: { columns: { review: 'text' } },
  messages: { columns: { message: 'text' } },
  blocked_users: { columns: { reason: 'text' } },
  message_reports: { columns: { details: 'text', admin_notes: 'text' } },
  event_codes: { columns: { code: 'token' } },
  settings: { settings: { keyColumn: 'key', valueColumn: 'value' } },
};
