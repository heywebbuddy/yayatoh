import { defineSubscriber, type Mailer } from '@yayatoh/platform';
import { z } from 'zod';
import { signInvitation } from './domain/invitation-token.ts';

const Payload = z.object({ invitationId: z.uuid(), email: z.email(), role: z.string() });

/** Sends the invitation email (outbox → worker). The token is derived here, never stored. */
export function invitationMailer(deps: { mailer: Mailer; appOrigin: string; secret: string }) {
  return defineSubscriber({
    name: 'tenancy.invitation-mailer',
    events: ['invitation.created@1'],
    handle: async (_tx, event) => {
      const p = Payload.parse(event.payload);
      const url = `${deps.appOrigin}/invite/${encodeURIComponent(signInvitation(p.invitationId, deps.secret))}`;
      await deps.mailer.send({
        to: p.email,
        template: 'tenancy.invitation',
        params: { url, role: p.role },
        idempotencyKey: `invitation:${p.invitationId}`,
      });
    },
  });
}
