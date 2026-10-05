CREATE TABLE "integrations"."sheet_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"linked_by" uuid,
	"unlinked_at" timestamp with time zone,
	CONSTRAINT "sheet_links_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sheet_links_status_check" CHECK (status in ('active', 'unlinked')),
	CONSTRAINT "sheet_links_unlinked_check" CHECK ((status = 'unlinked') = (unlinked_at is not null)),
	CONSTRAINT "sheet_links_spreadsheet_check" CHECK (spreadsheet_id ~ '^[A-Za-z0-9_-]{1,128}$'),
	CONSTRAINT "sheet_links_title_check" CHECK (length(title) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "integrations"."sheet_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."sheet_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations"."sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"field" text NOT NULL,
	"kept" text NOT NULL,
	"lost" text NOT NULL,
	CONSTRAINT "sync_conflicts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sync_conflicts_field_check" CHECK (field ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "sync_conflicts_values_check" CHECK (length(kept) <= 1000 and length(lost) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "integrations"."sync_conflicts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."sync_conflicts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."sync_errors" DROP CONSTRAINT "sync_errors_step_check";--> statement-breakpoint
ALTER TABLE "integrations"."sheet_links" ADD CONSTRAINT "sheet_links_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."sync_conflicts" ADD CONSTRAINT "sync_conflicts_error_fk" FOREIGN KEY ("org_id","error_id") REFERENCES "integrations"."sync_errors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."sync_conflicts" ADD CONSTRAINT "sync_conflicts_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sheet_links_org_id_idx" ON "integrations"."sheet_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_links_org_connection_event_active_key" ON "integrations"."sheet_links" USING btree ("org_id","connection_id","event_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_links_org_spreadsheet_active_key" ON "integrations"."sheet_links" USING btree ("org_id","spreadsheet_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "sheet_links_org_event_idx" ON "integrations"."sheet_links" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "sync_conflicts_org_id_idx" ON "integrations"."sync_conflicts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_conflicts_org_error_field_key" ON "integrations"."sync_conflicts" USING btree ("org_id","error_id","field");--> statement-breakpoint
CREATE INDEX "sync_conflicts_org_connection_idx" ON "integrations"."sync_conflicts" USING btree ("org_id","connection_id");--> statement-breakpoint
-- hand-written: begin (M6.4b: the widened CHECK on the existing sync_errors table added NOT VALID, then validated)
ALTER TABLE "integrations"."sync_errors" ADD CONSTRAINT "sync_errors_step_check" CHECK (step in ('auth', 'pull', 'map', 'write', 'push', 'conflict')) NOT VALID;--> statement-breakpoint
ALTER TABLE "integrations"."sync_errors" VALIDATE CONSTRAINT "sync_errors_step_check";--> statement-breakpoint
-- hand-written: end

CREATE POLICY "sheet_links_tenant_isolation" ON "integrations"."sheet_links" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sync_conflicts_tenant_isolation" ON "integrations"."sync_conflicts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin (M6.4b: a sheet link's event, a cross-module composite FK to a lower tier)
ALTER TABLE "integrations"."sheet_links" ADD CONSTRAINT "sheet_links_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
