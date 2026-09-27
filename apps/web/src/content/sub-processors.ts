/**
 * Sub-processors (roadmap §10 Privacy: listed with 30 days' notice of changes). DRAFT: the list
 * follows the hosting recommendation (roadmap §3.6); it becomes final once the owner opens the
 * accounts and counsel signs off (owner inbox, M1.14). Purposes and data are translated
 * (`subprocessors.purposes.*`, `subprocessors.data.*`); names and locations are not.
 */
export const SUB_PROCESSORS = [
  { key: 'vercel', name: 'Vercel Inc.', location: 'United States', data: 'traffic' },
  { key: 'neon', name: 'Neon Inc.', location: 'United States', data: 'all' },
  { key: 'fly', name: 'Fly.io Inc.', location: 'United States', data: 'all' },
  { key: 'upstash', name: 'Upstash Inc.', location: 'United States', data: 'traffic' },
  { key: 'cloudflare', name: 'Cloudflare Inc.', location: 'United States / global edge', data: 'files' },
  { key: 'aws', name: 'Amazon Web Services Inc.', location: 'United States', data: 'contact' },
  { key: 'stripe', name: 'Stripe Inc.', location: 'United States', data: 'payment' },
  { key: 'twilio', name: 'Twilio Inc.', location: 'United States', data: 'contact' },
  { key: 'ably', name: 'Ably Realtime Ltd.', location: 'European Union / United States', data: 'traffic' },
  { key: 'sentry', name: 'Functional Software Inc. (Sentry)', location: 'United States', data: 'traffic' },
  { key: 'axiom', name: 'Axiom Inc.', location: 'United States', data: 'traffic' },
] as const;

export type SubProcessorKey = (typeof SUB_PROCESSORS)[number]['key'];

/** Sections of the Yayatoh privacy notice, in order (`privacyNotice.sections.<key>.title|body`). */
export const PRIVACY_SECTIONS = [
  'roles',
  'data',
  'purposes',
  'sharing',
  'retention',
  'security',
  'rights',
  'contact',
] as const;

/** When the draft texts were last changed (shown on the pages). */
export const PRIVACY_UPDATED = '2026-09-27';
