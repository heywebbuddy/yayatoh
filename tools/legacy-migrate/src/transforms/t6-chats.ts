import { exec, hasTable, type StepContext } from './context.ts';

/**
 * T6 remainder (M2.2d): the legacy attendee-to-attendee chat (`chats`, `messages`), its blocks
 * (`blocked_users`) and message reports (`message_reports`).
 *
 * **Not carried: no target module exists.** The new messaging module (M1.10c) is organizer ↔
 * contact conversations with organizer/contact blocks and staff-reviewed reports; the legacy chat
 * is a per-event networking chat between two attendees (both must hold tickets), a different
 * product with different parties and privacy expectations. Mapping one onto the other would show
 * attendees' private messages to organizers. The rows stay in the staging schema (kept 12 months,
 * never visible to app_user or platform_reader), and every one is listed for the owner:
 * `chat_not_migrated` (with its message count), `chat_block_not_migrated`, and
 * `chat_report_not_migrated` (with its status: `pending` and `under_review` reports were never
 * resolved in legacy).
 */
export async function t6Chats(ctx: StepContext): Promise<void> {
  if (await hasTable(ctx, 'chats')) {
    const messages = await hasTable(ctx, 'messages');
    await exec(
      ctx,
      `
      insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
      select {run}, {inst}, 'chat_not_migrated', 'chats', c.id::text,
             jsonb_build_object('event', c.event_id, 'messages', ${
               messages ? '(select count(*) from {s}.messages m where m.chat_id = c.id)' : '0'
             }, 'reason', 'no_target_module')
      from {s}.chats c;
    `,
    );
  }
  if (await hasTable(ctx, 'blocked_users'))
    await exec(
      ctx,
      `
      insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
      select {run}, {inst}, 'chat_block_not_migrated', 'blocked_users', b.id::text,
             jsonb_build_object('event', b.event_id, 'reason', 'no_target_module')
      from {s}.blocked_users b;
    `,
    );
  if (await hasTable(ctx, 'message_reports'))
    await exec(
      ctx,
      `
      insert into legacy.exceptions (run_id, instance, kind, legacy_table, legacy_id, detail)
      select {run}, {inst}, 'chat_report_not_migrated', 'message_reports', r.id::text,
             jsonb_build_object('status', r.status, 'reason_code', r.reason, 'event', r.event_id, 'reason', 'no_target_module')
      from {s}.message_reports r;
    `,
    );
}
