CREATE TABLE "platform"."realtime_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "platform"."realtime_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "realtime_messages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "realtime_messages_channel_org" CHECK (channel like 'org:' || org_id::text || ':%' and length(channel) <= 160),
	CONSTRAINT "realtime_messages_event_length" CHECK (length(event) between 1 and 40),
	CONSTRAINT "realtime_messages_data_size" CHECK (pg_column_size(data) <= 16384)
);
--> statement-breakpoint
ALTER TABLE "platform"."realtime_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."realtime_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "realtime_messages_org_id_idx" ON "platform"."realtime_messages" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_messages_org_seq_key" ON "platform"."realtime_messages" USING btree ("org_id","seq");--> statement-breakpoint
CREATE INDEX "realtime_messages_org_channel_seq_idx" ON "platform"."realtime_messages" USING btree ("org_id","channel","seq");--> statement-breakpoint
CREATE INDEX "realtime_messages_org_created_at_idx" ON "platform"."realtime_messages" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "realtime_messages_tenant_isolation" ON "platform"."realtime_messages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M3.1b realtime message log: append-only, NOTIFY on commit, pruning)
-- The log is append-only for the app: messages are never edited, and only the retention
-- function below deletes them.
REVOKE UPDATE, DELETE ON "platform"."realtime_messages" FROM app_user;--> statement-breakpoint
-- Wake every web process's listener with "{seq} {channel}" (never the payload: listeners fetch
-- the row by id under the org's RLS). NOTIFY is transactional, so a message is announced only
-- once its transaction commits, and never for a rolled-back one. Runs as the caller.
CREATE FUNCTION platform.realtime_messages_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('realtime_messages', NEW.seq::text || ' ' || NEW.channel);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER realtime_messages_notify AFTER INSERT ON "platform"."realtime_messages"
  FOR EACH ROW EXECUTE FUNCTION platform.realtime_messages_notify();--> statement-breakpoint
-- Retention (worker): realtime messages are derived and only needed for short resumptions.
CREATE FUNCTION platform.purge_realtime_messages() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH d AS (
    DELETE FROM platform.realtime_messages WHERE created_at < now() - interval '1 hour' RETURNING 1
  )
  SELECT count(*)::integer FROM d
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.purge_realtime_messages() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.purge_realtime_messages() TO app_user, platform_reader;--> statement-breakpoint
-- The public realtime channels of an event (its live seat availability) by id: the event must be
-- published and listed (public or unlisted) and its org active — the same rule as
-- events.checkout_target(slug). Returns the ids only.
CREATE FUNCTION events.public_event_target(p_org uuid, p_event uuid)
RETURNS TABLE (org_id uuid, event_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.org_id, e.id FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status = 'active'
  WHERE e.org_id = p_org AND e.id = p_event
    AND e.status = 'published' AND e.visibility IN ('public', 'unlisted')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.public_event_target(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.public_event_target(uuid, uuid) TO app_user;
-- hand-written: end
