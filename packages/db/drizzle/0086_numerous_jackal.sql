CREATE TABLE "checkin"."device_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" uuid NOT NULL,
	"event_id" uuid,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"battery_pct" integer,
	CONSTRAINT "device_events_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "device_events_kind_check" CHECK (kind in ('online', 'offline', 'low_battery', 'revoked', 'wiped')),
	CONSTRAINT "device_events_battery_check" CHECK (battery_pct is null or battery_pct between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "checkin"."device_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."device_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "checkin"."staff_presence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"checkpoint_id" uuid,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "staff_presence_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "staff_presence_source_check" CHECK (source in ('door_screen', 'device')),
	CONSTRAINT "staff_presence_time_check" CHECK (last_seen_at >= started_at)
);
--> statement-breakpoint
ALTER TABLE "checkin"."staff_presence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."staff_presence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "command_center"."display_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "display_links_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "display_links_label_check" CHECK (length(label) between 1 and 60),
	CONSTRAINT "display_links_token_hash_check" CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "command_center"."display_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "command_center"."display_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "checkin"."device_events" ADD CONSTRAINT "device_events_device_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "checkin"."devices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_events_org_id_idx" ON "checkin"."device_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "device_events_org_event_at_idx" ON "checkin"."device_events" USING btree ("org_id","event_id","at");--> statement-breakpoint
CREATE INDEX "device_events_org_device_at_idx" ON "checkin"."device_events" USING btree ("org_id","device_id","at");--> statement-breakpoint
CREATE INDEX "staff_presence_org_id_idx" ON "checkin"."staff_presence" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_presence_org_event_user_key" ON "checkin"."staff_presence" USING btree ("org_id","event_id","user_id");--> statement-breakpoint
CREATE INDEX "staff_presence_org_event_seen_idx" ON "checkin"."staff_presence" USING btree ("org_id","event_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "display_links_org_id_idx" ON "command_center"."display_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "display_links_token_hash_key" ON "command_center"."display_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "display_links_org_event_idx" ON "command_center"."display_links" USING btree ("org_id","event_id");--> statement-breakpoint
ALTER TABLE "checkin"."checkpoints" ADD CONSTRAINT "checkpoints_capacity_check" CHECK (capacity is null or capacity between 1 and 1000000) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."devices" ADD CONSTRAINT "devices_app_version_check" CHECK (app_version is null or app_version ~ '^[A-Za-z0-9._+-]{1,64}$') NOT VALID;--> statement-breakpoint
CREATE POLICY "device_events_tenant_isolation" ON "checkin"."device_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "staff_presence_tenant_isolation" ON "checkin"."staff_presence" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "display_links_tenant_isolation" ON "command_center"."display_links" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- The new checks on existing tables were added NOT VALID (no long lock); validate now.
ALTER TABLE "checkin"."checkpoints" VALIDATE CONSTRAINT "checkpoints_capacity_check";--> statement-breakpoint
ALTER TABLE "checkin"."devices" VALIDATE CONSTRAINT "devices_app_version_check";--> statement-breakpoint
-- Composite FKs down to events and checkpoints (other tables: hand-written, like M3.4a's).
ALTER TABLE "checkin"."device_events" ADD CONSTRAINT "device_events_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "checkin"."staff_presence" ADD CONSTRAINT "staff_presence_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "checkin"."staff_presence" ADD CONSTRAINT "staff_presence_device_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "checkin"."devices"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "checkin"."staff_presence" ADD CONSTRAINT "staff_presence_checkpoint_fk" FOREIGN KEY ("org_id","checkpoint_id") REFERENCES "checkin"."checkpoints"("org_id","id");--> statement-breakpoint
ALTER TABLE "command_center"."display_links" ADD CONSTRAINT "display_links_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
-- Device transitions are history: the app appends them, never rewrites them.
REVOKE UPDATE, TRUNCATE ON "checkin"."device_events" FROM app_user;--> statement-breakpoint
-- TV mode: the display link's token alone finds its org and event (ids only), while the link is
-- live and its org active; the web resolves it before opening the org's tenant transaction.
CREATE FUNCTION command_center.display_link_target(p_token_hash text)
RETURNS TABLE (org_id uuid, event_id uuid, link_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.org_id, l.event_id, l.id FROM command_center.display_links l
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status = 'active'
  WHERE l.token_hash = p_token_hash AND l.revoked_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION command_center.display_link_target(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION command_center.display_link_target(text) TO app_user;--> statement-breakpoint
-- The worker's live device watchdog: orgs with a device whose offline moment (last heartbeat +
-- the offline window) fell in (p_from, p_to]. Org ids only.
CREATE FUNCTION checkin.orgs_with_devices_going_quiet(p_from timestamptz, p_to timestamptz, p_window_ms integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT d.org_id FROM checkin.devices d
  WHERE d.revoked_at IS NULL AND d.wipe_requested_at IS NULL
    AND d.last_seen_at + make_interval(secs => p_window_ms / 1000.0) > p_from
    AND d.last_seen_at + make_interval(secs => p_window_ms / 1000.0) <= p_to
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION checkin.orgs_with_devices_going_quiet(timestamptz, timestamptz, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION checkin.orgs_with_devices_going_quiet(timestamptz, timestamptz, integer) TO platform_reader;
-- hand-written: end
