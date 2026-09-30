// Canary: reaching into another module's private schema must fail.
import { events } from '@yayatoh/events/schema';
import { helper } from '../../events/src/index.ts';
export const ticketTypes = [events, helper];
