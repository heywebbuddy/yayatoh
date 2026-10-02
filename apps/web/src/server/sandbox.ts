import 'server-only';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, executeCommand } from '@yayatoh/kernel';
import { createSandboxOrg, type SandboxDto } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { ports } from './ports.ts';

const DAY = 86_400_000;

/**
 * Create a sandbox org linked to the context org (M6.3a) and seed it: one published sample event
 * a month from now with a free and a paid ticket type, so the API, checkout (fake payments) and
 * check-in can be tried at once. The member who creates it owns it.
 */
export async function createSeededSandbox(ctx: Ctx, name: string): Promise<SandboxDto> {
  const sandbox = await createSandboxOrg(ctx, { name }, ports);
  if (ctx.actor.type !== 'user') return sandbox;
  const owner: Ctx = { ...ctx, orgId: sandbox.sandboxOrgId, idempotencyKey: null };
  const start = new Date(Math.ceil((Date.now() + 30 * DAY) / DAY) * DAY + 18 * 3_600_000);
  const event = await executeCommand(
    createEventCommand,
    {
      name: 'Sample conference',
      tagline: 'Sandbox data: try the API, checkout and check-in. Payments are fake.',
      timezone: 'UTC',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 4 * 3_600_000).toISOString(),
      venueName: 'Sandbox Hall',
      city: 'Chicago',
    },
    owner,
    ports,
  );
  for (const [ticketName, priceMinor] of [
    ['Free pass', 0],
    ['Full pass', 4900],
  ] as const)
    await executeCommand(
      createTicketTypeCommand,
      { eventId: event.id, name: ticketName, priceMinor, quantityTotal: 100 },
      owner,
      ports,
    );
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, owner, ports);
  return sandbox;
}
