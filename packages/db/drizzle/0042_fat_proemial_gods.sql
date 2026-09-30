CREATE SCHEMA "messaging";
--> statement-breakpoint
CREATE SCHEMA "notifications";
--> statement-breakpoint
CREATE TABLE "messaging"."announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"channels" text[] NOT NULL,
	"recipients" integer NOT NULL,
	"sent_by" uuid,
	CONSTRAINT "announcements_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "announcements_subject_length" CHECK (length(subject) between 1 and 150),
	CONSTRAINT "announcements_body_length" CHECK (length(body) between 1 and 5000),
	CONSTRAINT "announcements_channels_check" CHECK (channels <@ array['email', 'push']::text[] and cardinality(channels) > 0)
);
--> statement-breakpoint
ALTER TABLE "messaging"."announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging"."announcements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging"."reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_id" uuid NOT NULL,
	"reporter" text NOT NULL,
	"reporter_user_id" uuid,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	CONSTRAINT "reports_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "reports_reporter_check" CHECK (reporter in ('organizer', 'contact')),
	CONSTRAINT "reports_reason_check" CHECK (reason in ('spam', 'abuse', 'other')),
	CONSTRAINT "reports_status_check" CHECK (status in ('open', 'reviewed')),
	CONSTRAINT "reports_note_length" CHECK (note is null or length(note) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "messaging"."reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging"."reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging"."thread_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"body" text,
	"announcement_id" uuid,
	"author_user_id" uuid,
	"event_id" uuid,
	CONSTRAINT "thread_messages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "thread_messages_direction_check" CHECK (direction in ('in', 'out')),
	CONSTRAINT "thread_messages_content_check" CHECK ((body is not null and length(body) between 1 and 5000) or announcement_id is not null)
);
--> statement-breakpoint
ALTER TABLE "messaging"."thread_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging"."thread_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging"."threads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_email_norm" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_name" text,
	"last_event_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_by" uuid,
	"contact_blocked_at" timestamp with time zone,
	CONSTRAINT "threads_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "threads_email_norm_check" CHECK (contact_email_norm = lower(btrim(contact_email_norm)) and contact_email_norm like '%@%')
);
--> statement-breakpoint
ALTER TABLE "messaging"."threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging"."threads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"href" text,
	"dedupe_key" text NOT NULL,
	"order_id" uuid,
	"event_id" uuid,
	"read_at" timestamp with time zone,
	CONSTRAINT "inbox_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "inbox_items_href_check" CHECK (href is null or href ~ '^/[^/]')
);
--> statement-breakpoint
ALTER TABLE "notifications"."inbox_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."inbox_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"recipient_email" text,
	"recipient_user_id" uuid,
	"recipient_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"time_zone" text,
	"order_id" uuid,
	"event_id" uuid,
	"params_ciphertext" text NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"subject" text,
	"sent_at" timestamp with time zone,
	CONSTRAINT "messages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "messages_channel_check" CHECK (channel in ('email', 'sms', 'push')),
	CONSTRAINT "messages_status_check" CHECK (status in ('queued', 'sent', 'suppressed', 'failed', 'canceled')),
	CONSTRAINT "messages_category_check" CHECK (category in ('transactional', 'reminders', 'event_updates', 'marketing', 'sales', 'messages')),
	CONSTRAINT "messages_dedupe_key_length" CHECK (length(dedupe_key) between 1 and 255),
	CONSTRAINT "messages_address_check" CHECK ((channel = 'email' and (recipient_email is not null or recipient_user_id is not null)) or (channel = 'push' and recipient_user_id is not null) or channel = 'sms')
);
--> statement-breakpoint
ALTER TABLE "notifications"."messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "preferences_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "preferences_category_check" CHECK (category in ('transactional', 'reminders', 'event_updates', 'marketing', 'sales', 'messages')),
	CONSTRAINT "preferences_channel_check" CHECK (channel in ('in_app', 'email', 'sms', 'push'))
);
--> statement-breakpoint
ALTER TABLE "notifications"."preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "push_tokens_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "push_tokens_platform_check" CHECK (platform in ('fcm', 'apns', 'webpush')),
	CONSTRAINT "push_tokens_source_check" CHECK (source in ('app', 'web', 'legacy')),
	CONSTRAINT "push_tokens_token_length" CHECK (length(token) between 8 and 4096)
);
--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."suppressions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_norm" text NOT NULL,
	"category" text NOT NULL,
	"source" text NOT NULL,
	"message_id" uuid,
	CONSTRAINT "suppressions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "suppressions_email_norm_check" CHECK (email_norm = lower(btrim(email_norm)) and email_norm like '%@%'),
	CONSTRAINT "suppressions_category_check" CHECK (category <> 'transactional'),
	CONSTRAINT "suppressions_source_check" CHECK (source in ('one_click', 'page', 'legacy', 'block'))
);
--> statement-breakpoint
ALTER TABLE "notifications"."suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."suppressions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."template_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text,
	"intro" text,
	"updated_by" text NOT NULL,
	CONSTRAINT "template_overrides_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "template_overrides_subject_length" CHECK (subject is null or length(subject) between 1 and 200),
	CONSTRAINT "template_overrides_intro_length" CHECK (intro is null or length(intro) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "notifications"."template_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."template_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging"."reports" ADD CONSTRAINT "reports_thread_fk" FOREIGN KEY ("org_id","thread_id") REFERENCES "messaging"."threads"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging"."thread_messages" ADD CONSTRAINT "thread_messages_thread_fk" FOREIGN KEY ("org_id","thread_id") REFERENCES "messaging"."threads"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging"."thread_messages" ADD CONSTRAINT "thread_messages_announcement_fk" FOREIGN KEY ("org_id","announcement_id") REFERENCES "messaging"."announcements"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_org_id_idx" ON "messaging"."announcements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "announcements_org_event_created_idx" ON "messaging"."announcements" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_org_id_idx" ON "messaging"."reports" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "reports_org_thread_idx" ON "messaging"."reports" USING btree ("org_id","thread_id");--> statement-breakpoint
CREATE INDEX "thread_messages_org_id_idx" ON "messaging"."thread_messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "thread_messages_org_thread_created_idx" ON "messaging"."thread_messages" USING btree ("org_id","thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_messages_org_thread_announcement_key" ON "messaging"."thread_messages" USING btree ("org_id","thread_id","announcement_id") WHERE announcement_id is not null;--> statement-breakpoint
CREATE INDEX "threads_org_id_idx" ON "messaging"."threads" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_org_contact_key" ON "messaging"."threads" USING btree ("org_id","contact_email_norm");--> statement-breakpoint
CREATE INDEX "threads_org_last_message_idx" ON "messaging"."threads" USING btree ("org_id","last_message_at");--> statement-breakpoint
CREATE INDEX "inbox_items_org_id_idx" ON "notifications"."inbox_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_org_user_dedupe_key" ON "notifications"."inbox_items" USING btree ("org_id","user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "inbox_items_org_user_created_idx" ON "notifications"."inbox_items" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_items_org_user_unread_idx" ON "notifications"."inbox_items" USING btree ("org_id","user_id") WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "messages_org_id_idx" ON "notifications"."messages" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_channel_dedupe_key" ON "notifications"."messages" USING btree ("org_id","channel","dedupe_key");--> statement-breakpoint
CREATE INDEX "messages_org_order_idx" ON "notifications"."messages" USING btree ("org_id","order_id","created_at") WHERE order_id is not null;--> statement-breakpoint
CREATE INDEX "messages_org_due_idx" ON "notifications"."messages" USING btree ("org_id","send_after") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "messages_due_orgs_idx" ON "notifications"."messages" USING btree ("send_after","org_id") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "preferences_org_id_idx" ON "notifications"."preferences" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preferences_org_user_category_channel_key" ON "notifications"."preferences" USING btree ("org_id","user_id","category","channel");--> statement-breakpoint
CREATE INDEX "push_tokens_org_id_idx" ON "notifications"."push_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_org_platform_token_key" ON "notifications"."push_tokens" USING btree ("org_id","platform","token");--> statement-breakpoint
CREATE INDEX "push_tokens_org_user_idx" ON "notifications"."push_tokens" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "suppressions_org_id_idx" ON "notifications"."suppressions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_org_email_category_key" ON "notifications"."suppressions" USING btree ("org_id","email_norm","category");--> statement-breakpoint
CREATE INDEX "template_overrides_org_id_idx" ON "notifications"."template_overrides" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_overrides_org_kind_locale_key" ON "notifications"."template_overrides" USING btree ("org_id","kind","locale");--> statement-breakpoint
CREATE POLICY "announcements_tenant_isolation" ON "messaging"."announcements" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "reports_tenant_isolation" ON "messaging"."reports" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "thread_messages_tenant_isolation" ON "messaging"."thread_messages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "threads_tenant_isolation" ON "messaging"."threads" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "inbox_items_tenant_isolation" ON "notifications"."inbox_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "messages_tenant_isolation" ON "notifications"."messages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "preferences_tenant_isolation" ON "notifications"."preferences" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "push_tokens_tenant_isolation" ON "notifications"."push_tokens" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "suppressions_tenant_isolation" ON "notifications"."suppressions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "template_overrides_tenant_isolation" ON "notifications"."template_overrides" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M1.10 notifications: the message log is append-and-update only (no deletes by the app).
REVOKE DELETE, TRUNCATE ON notifications.messages FROM app_user;
--> statement-breakpoint
-- Unsubscribe links: message id (from a verified HMAC token) → its org. Ids only.
CREATE FUNCTION notifications.message_org(p_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT m.org_id FROM notifications.messages m WHERE m.id = p_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications.message_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifications.message_org(uuid) TO app_user;
--> statement-breakpoint
-- Dispatcher (worker): which orgs have messages due now.
CREATE FUNCTION notifications.orgs_with_due_messages(p_limit integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT m.org_id FROM notifications.messages m
  WHERE m.status = 'queued' AND m.send_after <= now()
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications.orgs_with_due_messages(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifications.orgs_with_due_messages(integer) TO platform_reader;
--> statement-breakpoint
-- M1.10c messaging: announcements belong to an event of the same org (down the tiers).
ALTER TABLE messaging.announcements
  ADD CONSTRAINT announcements_event_fk FOREIGN KEY (org_id, event_id) REFERENCES events.events (org_id, id);
--> statement-breakpoint
-- The sent log is permanent: no deletes by the app.
REVOKE DELETE, TRUNCATE ON messaging.announcements FROM app_user;
--> statement-breakpoint
-- Reply links: thread id (from a verified HMAC token) → its org. Ids only.
CREATE FUNCTION messaging.thread_org(p_id uuid)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.org_id FROM messaging.threads t WHERE t.id = p_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION messaging.thread_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION messaging.thread_org(uuid) TO app_user;
-- hand-written: end
