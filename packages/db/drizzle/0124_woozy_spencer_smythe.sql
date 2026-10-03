CREATE TABLE "badges"."print_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"printer_id" uuid,
	"adapter" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"locale" text NOT NULL,
	"request_key" text NOT NULL,
	"provider_job_id" text,
	"error_code" text,
	"requested_by" uuid,
	"sent_at" timestamp with time zone,
	CONSTRAINT "print_jobs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "print_jobs_adapter_check" CHECK (adapter in ('browser', 'printnode')),
	CONSTRAINT "print_jobs_kind_check" CHECK (kind in ('print', 'reprint')),
	CONSTRAINT "print_jobs_reason_check" CHECK (reason in ('first_print', 'damaged', 'lost', 'details_changed', 'misprint', 'printer_problem', 'other')),
	CONSTRAINT "print_jobs_kind_reason_check" CHECK ((kind = 'print') = (reason = 'first_print')),
	CONSTRAINT "print_jobs_note_check" CHECK (note is null or char_length(note) between 1 and 200),
	CONSTRAINT "print_jobs_other_note_check" CHECK (reason <> 'other' or note is not null),
	CONSTRAINT "print_jobs_status_check" CHECK (status in ('queued', 'sent', 'failed')),
	CONSTRAINT "print_jobs_source_check" CHECK (source in ('desk', 'attendee_page', 'kiosk')),
	CONSTRAINT "print_jobs_request_key_check" CHECK (char_length(request_key) between 8 and 80),
	CONSTRAINT "print_jobs_printnode_check" CHECK (adapter = 'browser' or printer_id is not null)
);
--> statement-breakpoint
ALTER TABLE "badges"."print_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."print_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "badges"."print_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"printnode_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "print_settings_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "badges"."print_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."print_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "badges"."printers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"adapter" text NOT NULL,
	"printnode_printer_id" integer,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"offline_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "printers_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "printers_name_length_check" CHECK (char_length(name) between 1 and 60),
	CONSTRAINT "printers_adapter_check" CHECK (adapter in ('browser', 'printnode')),
	CONSTRAINT "printers_status_check" CHECK (status in ('unknown', 'online', 'offline')),
	CONSTRAINT "printers_printnode_check" CHECK ((adapter = 'printnode') = (printnode_printer_id is not null) and coalesce(printnode_printer_id, 1) > 0),
	CONSTRAINT "printers_offline_check" CHECK ((status = 'offline') = (offline_at is not null))
);
--> statement-breakpoint
ALTER TABLE "badges"."printers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."printers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."print_jobs" ADD CONSTRAINT "print_jobs_printer_fk" FOREIGN KEY ("org_id","printer_id") REFERENCES "badges"."printers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "print_jobs_org_id_idx" ON "badges"."print_jobs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "print_jobs_org_event_idx" ON "badges"."print_jobs" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "print_jobs_org_ticket_idx" ON "badges"."print_jobs" USING btree ("org_id","ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "print_jobs_org_printer_idx" ON "badges"."print_jobs" USING btree ("org_id","printer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "print_jobs_org_request_key" ON "badges"."print_jobs" USING btree ("org_id","request_key");--> statement-breakpoint
CREATE INDEX "print_settings_org_id_idx" ON "badges"."print_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "print_settings_org_key" ON "badges"."print_settings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "printers_org_id_idx" ON "badges"."printers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "printers_org_event_idx" ON "badges"."printers" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "printers_org_status_idx" ON "badges"."printers" USING btree ("org_id","status","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "printers_org_event_name_key" ON "badges"."printers" USING btree ("org_id","event_id",lower(name)) WHERE archived_at is null;--> statement-breakpoint
CREATE POLICY "print_jobs_tenant_isolation" ON "badges"."print_jobs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "print_settings_tenant_isolation" ON "badges"."print_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "printers_tenant_isolation" ON "badges"."printers" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FKs, down the tiers (badges 5 → events 2, ticketing 3); new tables, so no NOT VALID needed.
ALTER TABLE "badges"."printers" ADD CONSTRAINT "printers_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "badges"."print_jobs" ADD CONSTRAINT "print_jobs_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "badges"."print_jobs" ADD CONSTRAINT "print_jobs_ticket_fk" FOREIGN KEY ("org_id","ticket_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
-- The worker's printer watchdog (M5.5b): orgs with an online printer silent for the window at
-- p_now. Org ids only.
CREATE FUNCTION badges.orgs_with_quiet_printers(p_now timestamptz, p_window_ms integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT p.org_id FROM badges.printers p
  WHERE p.status = 'online' AND p.archived_at IS NULL
    AND p.last_seen_at <= p_now - make_interval(secs => p_window_ms / 1000.0)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION badges.orgs_with_quiet_printers(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION badges.orgs_with_quiet_printers(timestamptz, integer) TO platform_reader;
--> statement-breakpoint
-- The worker's PrintNode poll (M5.5b): orgs with PrintNode switched on and a PrintNode printer.
-- Org ids only.
CREATE FUNCTION badges.orgs_with_printnode_printers()
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT p.org_id FROM badges.printers p
  JOIN badges.print_settings s ON s.org_id = p.org_id AND s.printnode_enabled
  WHERE p.adapter = 'printnode' AND p.archived_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION badges.orgs_with_printnode_printers() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION badges.orgs_with_printnode_printers() TO platform_reader;
-- hand-written: end
