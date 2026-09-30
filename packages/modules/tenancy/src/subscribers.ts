import { defineSubscriber, type Notifier } from '@yayatoh/platform';
import { z } from 'zod';
import { signInvitation } from './domain/invitation-token.ts';
import { organizationNameTx } from './queries.ts';

const Payload = z.object({
  invitationId: z.uuid(),
  email: z.email(),
  role: z.string(),
  // M4.2a: event invitations (co-host, planner) name the event and the event role.
  eventRole: z.string().optional(),
  eventName: z.string().optional(),
});

/** Queues the invitation email (outbox → worker). The token is derived here, never stored. */
export function invitationMailer(deps: { notifier: Notifier; appOrigin: string; secret: string }) {
  return defineSubscriber({
    name: 'tenancy.invitation-mailer',
    events: ['invitation.created@1'],
    handle: async (tx, event) => {
      const p = Payload.parse(event.payload);
      const url = `${deps.appOrigin}/invite/${encodeURIComponent(signInvitation(p.invitationId, deps.secret))}`;
      const org = await organizationNameTx(tx, event.orgId);
      await deps.notifier.enqueue(tx, {
        ...(p.eventRole
          ? {
              kind: 'tenancy.event-invitation',
              params: { url, role: p.eventRole, orgName: org ?? '', eventName: p.eventName ?? '' },
            }
          : { kind: 'tenancy.invitation', params: { url, role: p.role, orgName: org ?? '' } }),
        to: { email: p.email },
        dedupeKey: `invitation:${p.invitationId}`,
      });
    },
  });
}
