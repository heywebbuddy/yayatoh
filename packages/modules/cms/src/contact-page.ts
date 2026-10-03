import { defineSerializer, LOCALES, sanitizeMarkdown } from '@yayatoh/contracts';
import { withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import {
  defineSubscriber,
  type Notifier,
  type Subscriber,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CMS_READ, CMS_WRITE } from './cms.ts';
import { contactPages, contactRequests } from './schema.ts';

/**
 * U10: the org's contact page block. A visitor writes through a form on the org's own site (its
 * tenant site's `/contact`, or `/o/{slug}/contact` on the marketplace); the message is kept for
 * the org (`contact_requests`, source `org_site`) and its members are notified (inbox and email,
 * kind `cms.contact_message`). The page never shows any address of the org: replies go from the
 * organizer's own mail. Spam: the web rate-limits (`orgContact`), checks a honeypot and a minimum
 * fill time, and asks the human check where a provider is configured. One form, one message:
 * the form's one-time key is unique per org, so a resubmission delivers nothing twice.
 */
export const CONTACT_INTRO_MAX = 500;
export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 4000;

export const ContactPageDto = z.object({ enabled: z.boolean(), intro: z.string().nullable() });
export type ContactPageDto = z.infer<typeof ContactPageDto>;
/** What the public page gets: whether it is on, and its line of text. Nothing else. */
export const PublicContactPageDto = z.object({ intro: z.string().nullable() });
export type PublicContactPageDto = z.infer<typeof PublicContactPageDto>;
export const publicContactPageSerializer = defineSerializer('cms.publicContactPage', PublicContactPageDto);

const present = (row: { enabled: boolean; intro: string | null } | undefined): ContactPageDto => ({
  enabled: row?.enabled ?? false,
  intro: row?.intro ?? null,
});

/** The contact page settings (members who read the site's content). */
export const contactPageQuery = tenantQuery({
  name: 'cms.contactPage',
  input: z.object({}),
  output: ContactPageDto,
  entitlement: 'core',
  permission: CMS_READ,
  handler: async ({ tx }) => {
    const [row] = await tx.select().from(contactPages);
    return present(row);
  },
});

/** Turn the contact page on or off and set its line of text (people who write the site). */
export const setContactPageCommand = tenantCommand({
  name: 'cms.setContactPage',
  input: z.object({
    enabled: z.boolean(),
    intro: z
      .string()
      .trim()
      .max(CONTACT_INTRO_MAX)
      .nullable()
      .default(null)
      .transform((v) => (v ? v.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim() || null : null)),
  }),
  output: ContactPageDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const values = { enabled: input.enabled, intro: input.intro };
    const [row] = await tx
      .insert(contactPages)
      .values({ orgId, ...values })
      .onConflictDoUpdate({ target: contactPages.orgId, set: { ...values, updatedAt: ctx.now } })
      .returning();
    return present(row);
  },
  audit: (input) => ({
    action: 'cms.contact_page.set',
    targetType: 'contact_page',
    targetId: 'contact',
    data: { enabled: input.enabled },
  }),
});

/** The public page's settings, or null when the org has it off (a 404). */
export async function publicContactPage(orgId: string): Promise<PublicContactPageDto | null> {
  return withTenant(createCtx({ orgId, actor: { type: 'system', name: 'cms.public' } }), async (tx) => {
    const [row] = await tx.select().from(contactPages);
    return row?.enabled ? publicContactPageSerializer.serialize({ intro: row.intro }) : null;
  });
}

export const OrgContactInput = z.object({
  /** The form's one-time key (rendered with the page): a resubmission is the same message. */
  submissionKey: z.uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.email().trim().toLowerCase().max(254),
  message: z.string().trim().min(CONTACT_MESSAGE_MIN).max(CONTACT_MESSAGE_MAX),
  /** The visitor agreed that the org may use their details to answer (the consent line). */
  consent: z.literal(true),
  locale: z.enum(LOCALES).default('en'),
});
export type OrgContactInput = z.input<typeof OrgContactInput>;

/**
 * A visitor's message through the org's contact page (public; the web rate-limits and checks for
 * spam first). Refused while the page is off. The event carries no personal data.
 */
export const submitOrgContactCommand = tenantCommand({
  name: 'cms.submitOrgContact',
  input: OrgContactInput,
  output: z.object({ ok: z.literal(true), duplicate: z.boolean() }),
  entitlement: 'core',
  permission: 'public:contact_request',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [page] = await tx.select({ enabled: contactPages.enabled }).from(contactPages);
    if (!page?.enabled) throw new DomainError('not_found', 'This organizer has no contact page');
    const [seen] = await tx
      .select({ id: contactRequests.id })
      .from(contactRequests)
      .where(eq(contactRequests.submissionKey, input.submissionKey));
    if (seen) return { ok: true as const, duplicate: true };
    const [row] = await tx
      .insert(contactRequests)
      .values({
        orgId,
        topic: 'other',
        source: 'org_site',
        submissionKey: input.submissionKey,
        name: input.name,
        email: input.email,
        company: null,
        message: sanitizeMarkdown(input.message, CONTACT_MESSAGE_MAX),
        locale: input.locale,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoNothing({
        target: [contactRequests.orgId, contactRequests.submissionKey],
        where: sql`submission_key is not null`,
      })
      .returning({ id: contactRequests.id });
    // A concurrent resubmission of the same form won the insert: this one is the same message.
    if (!row) return { ok: true as const, duplicate: true };
    const id = row.id;
    emit({
      type: 'cms.org_contact_received',
      version: 1,
      aggregateType: 'contact_request',
      aggregateId: id,
      payload: { orgId, requestId: id },
    });
    return { ok: true as const, duplicate: false };
  },
});

export const OrgContactMessageDto = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  message: z.string(),
  locale: z.string(),
  status: z.enum(['new', 'handled']),
  createdAt: z.date(),
});
export type OrgContactMessageDto = z.infer<typeof OrgContactMessageDto>;
const orgContactMessageSerializer = defineSerializer('cms.orgContactMessage', OrgContactMessageDto);

/** Messages from the org's contact page, newest first (personal data: the roles that write the site). */
export const orgContactMessagesQuery = tenantQuery({
  name: 'cms.orgContactMessages',
  input: z.object({ status: z.enum(['new', 'handled']).optional() }),
  output: z.array(OrgContactMessageDto),
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, tx }) =>
    orgContactMessageSerializer.serializeMany(
      await tx
        .select()
        .from(contactRequests)
        .where(
          and(
            eq(contactRequests.source, 'org_site'),
            input.status ? eq(contactRequests.status, input.status) : undefined,
          ),
        )
        .orderBy(desc(contactRequests.createdAt))
        .limit(200),
    ),
});

/** How many contact page messages are still new (the console badge). */
export const orgContactNewCountQuery = tenantQuery({
  name: 'cms.orgContactNewCount',
  input: z.object({}),
  output: z.object({ count: z.number().int() }),
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ tx }) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(contactRequests)
      .where(and(eq(contactRequests.source, 'org_site'), eq(contactRequests.status, 'new')));
    return { count: r?.n ?? 0 };
  },
});

/** A short, single-line excerpt for notifications (the full text is in the console). */
const excerpt = (s: string, max = 280) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return [...one].length > max ? `${[...one].slice(0, max - 1).join('')}…` : one;
};

/**
 * Tells the org's members a visitor wrote through the contact page (inbox, and email per their
 * preferences). Once per message: the dedupe key is the message id.
 */
export function orgContactNotifier(deps: { notifier: Notifier }): Subscriber {
  return defineSubscriber({
    name: 'cms.org-contact-notifier',
    events: ['cms.org_contact_received@1'],
    handle: async (tx, event) => {
      const p = z.object({ requestId: z.uuid() }).parse(event.payload);
      const [row] = await tx.select().from(contactRequests).where(eq(contactRequests.id, p.requestId));
      if (!row) return;
      await deps.notifier.notifyMembers(tx, {
        kind: 'cms.contact_message',
        params: { name: row.name, email: row.email, body: excerpt(row.message) },
        dedupeKey: `org-contact:${row.id}`,
        href: '/content/contact',
      });
    },
  });
}
