// Canary: a table defined without tenantTable() (so without RLS) must fail.
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';

const events = pgSchema('events');
export const eventRows = events.table('events', { id: uuid('id').primaryKey(), name: text('name') });
