CREATE TABLE "program"."agenda_publications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb,
	"snapshot_hash" text,
	"published_at" timestamp with time zone,
	"published_by" text,
	CONSTRAINT "agenda_publications_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "agenda_publications_state_check" CHECK (state in ('draft', 'published')),
	CONSTRAINT "agenda_publications_version_check" CHECK (version >= 0),
	CONSTRAINT "agenda_publications_snapshot_check" CHECK (state <> 'published' or (snapshot is not null and snapshot_hash is not null and published_at is not null))
);
--> statement-breakpoint
ALTER TABLE "program"."agenda_publications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."agenda_publications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."session_details" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"type_id" uuid,
	"admission" text DEFAULT 'included' NOT NULL,
	"group_id" uuid,
	"capacity" integer,
	"enrolled" integer DEFAULT 0 NOT NULL,
	"enrollment_open" boolean DEFAULT true NOT NULL,
	"import_key" text,
	CONSTRAINT "session_details_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "session_details_org_session_group_key" UNIQUE("org_id","session_id","group_id"),
	CONSTRAINT "session_details_admission_check" CHECK (admission in ('included', 'optional')),
	CONSTRAINT "session_details_enrolled_check" CHECK (enrolled >= 0 and (capacity is null or enrolled <= capacity)),
	CONSTRAINT "session_details_capacity_check" CHECK (capacity is null or capacity >= 1),
	CONSTRAINT "session_details_group_optional_check" CHECK (group_id is null or admission = 'optional'),
	CONSTRAINT "session_details_import_key_check" CHECK (import_key is null or char_length(import_key) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "program"."session_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."session_details" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."session_group_picks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"group_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"registrant_id" uuid NOT NULL,
	CONSTRAINT "session_group_picks_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "program"."session_group_picks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."session_group_picks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."session_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "session_groups_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "session_groups_name_length_check" CHECK (char_length(name) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "program"."session_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."session_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."session_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "session_types_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "session_types_name_length_check" CHECK (char_length(name) between 1 and 60),
	CONSTRAINT "session_types_position_check" CHECK (position between 0 and 999)
);
--> statement-breakpoint
ALTER TABLE "program"."session_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."session_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."speaker_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"speaker_id" uuid NOT NULL,
	"email" text NOT NULL,
	CONSTRAINT "speaker_contacts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "speaker_contacts_email_check" CHECK (email = lower(email) and email like '%_@_%')
);
--> statement-breakpoint
ALTER TABLE "program"."speaker_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."speaker_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."session_details" ADD CONSTRAINT "session_details_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."session_details" ADD CONSTRAINT "session_details_type_fk" FOREIGN KEY ("org_id","type_id") REFERENCES "program"."session_types"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."session_details" ADD CONSTRAINT "session_details_group_fk" FOREIGN KEY ("org_id","group_id") REFERENCES "program"."session_groups"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."session_group_picks" ADD CONSTRAINT "session_group_picks_session_group_fk" FOREIGN KEY ("org_id","session_id","group_id") REFERENCES "program"."session_details"("org_id","session_id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."speaker_contacts" ADD CONSTRAINT "speaker_contacts_speaker_fk" FOREIGN KEY ("org_id","speaker_id") REFERENCES "program"."speakers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agenda_publications_org_id_idx" ON "program"."agenda_publications" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agenda_publications_org_event_key" ON "program"."agenda_publications" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "session_details_org_id_idx" ON "program"."session_details" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_details_org_session_key" ON "program"."session_details" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_details_org_event_import_key" ON "program"."session_details" USING btree ("org_id","event_id","import_key") WHERE import_key is not null;--> statement-breakpoint
CREATE INDEX "session_details_org_event_idx" ON "program"."session_details" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "session_details_org_type_idx" ON "program"."session_details" USING btree ("org_id","type_id");--> statement-breakpoint
CREATE INDEX "session_details_org_group_idx" ON "program"."session_details" USING btree ("org_id","group_id");--> statement-breakpoint
CREATE INDEX "session_group_picks_org_id_idx" ON "program"."session_group_picks" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_group_picks_org_group_registrant_key" ON "program"."session_group_picks" USING btree ("org_id","group_id","registrant_id");--> statement-breakpoint
CREATE INDEX "session_group_picks_org_session_idx" ON "program"."session_group_picks" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE INDEX "session_groups_org_id_idx" ON "program"."session_groups" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_groups_org_event_name_key" ON "program"."session_groups" USING btree ("org_id","event_id",lower(name));--> statement-breakpoint
CREATE INDEX "session_types_org_id_idx" ON "program"."session_types" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_types_org_event_name_key" ON "program"."session_types" USING btree ("org_id","event_id",lower(name));--> statement-breakpoint
CREATE INDEX "session_types_org_event_position_idx" ON "program"."session_types" USING btree ("org_id","event_id","position");--> statement-breakpoint
CREATE INDEX "speaker_contacts_org_id_idx" ON "program"."speaker_contacts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_contacts_org_speaker_key" ON "program"."speaker_contacts" USING btree ("org_id","speaker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_contacts_org_event_email_key" ON "program"."speaker_contacts" USING btree ("org_id","event_id","email");--> statement-breakpoint
CREATE POLICY "agenda_publications_tenant_isolation" ON "program"."agenda_publications" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_details_tenant_isolation" ON "program"."session_details" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_group_picks_tenant_isolation" ON "program"."session_group_picks" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_groups_tenant_isolation" ON "program"."session_groups" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_types_tenant_isolation" ON "program"."session_types" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "speaker_contacts_tenant_isolation" ON "program"."speaker_contacts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FKs, down the tiers (program 3 → events 2); new tables, so no NOT VALID needed.
ALTER TABLE "program"."session_types" ADD CONSTRAINT "session_types_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "program"."session_groups" ADD CONSTRAINT "session_groups_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "program"."session_details" ADD CONSTRAINT "session_details_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "program"."agenda_publications" ADD CONSTRAINT "agenda_publications_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "program"."speaker_contacts" ADD CONSTRAINT "speaker_contacts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
-- M5.2a: every session has one session_details row (type, included/optional, group and the
-- capacity counter). The counter's capacity mirrors sessions.capacity. Runs as the caller under
-- the same RLS (the row's own org); lowering a capacity below `enrolled` fails the counter CHECK.
CREATE FUNCTION program.sync_session_details() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO program.session_details (org_id, event_id, session_id, capacity)
  VALUES (NEW.org_id, NEW.event_id, NEW.id, NEW.capacity)
  ON CONFLICT (org_id, session_id) DO UPDATE
    SET capacity = EXCLUDED.capacity, updated_at = now()
    WHERE program.session_details.capacity IS DISTINCT FROM EXCLUDED.capacity;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sessions_sync_details AFTER INSERT OR UPDATE OF capacity ON "program"."sessions"
  FOR EACH ROW EXECUTE FUNCTION program.sync_session_details();
--> statement-breakpoint
-- Backfill: one details row for every existing session (migrator bypasses RLS).
INSERT INTO "program"."session_details" (org_id, event_id, session_id, capacity)
SELECT org_id, event_id, id, capacity FROM "program"."sessions"
ON CONFLICT (org_id, session_id) DO NOTHING;
-- hand-written: end
