CREATE SCHEMA "badges";
--> statement-breakpoint
CREATE TABLE "badges"."assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"ticket_type_id" uuid,
	CONSTRAINT "assignments_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "assignments_target_check" CHECK (num_nonnulls(ticket_type_id) = 1)
);
--> statement-breakpoint
ALTER TABLE "badges"."assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "badges"."batch_parts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"batch_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"badges" integer NOT NULL,
	"pdf" "bytea" NOT NULL,
	CONSTRAINT "batch_parts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "batch_parts_seq_check" CHECK (seq >= 0 and badges >= 0)
);
--> statement-breakpoint
ALTER TABLE "badges"."batch_parts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."batch_parts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "badges"."batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sort" text NOT NULL,
	"locale" text NOT NULL,
	"ticket_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"ticket_ids" uuid[] NOT NULL,
	"version_map" jsonb NOT NULL,
	"total" integer NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"file_key" text,
	"bytes" integer,
	"requested_by" uuid,
	"error_code" text,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "batches_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "batches_status_check" CHECK (status in ('queued', 'running', 'done', 'cancelled', 'failed')),
	CONSTRAINT "batches_sort_check" CHECK (sort in ('last_name', 'company')),
	CONSTRAINT "batches_request_key_check" CHECK (char_length(request_key) between 8 and 80),
	CONSTRAINT "batches_counts_check" CHECK (total >= 0 and processed between 0 and total and skipped between 0 and total),
	CONSTRAINT "batches_done_check" CHECK ((status = 'done') = (file_key is not null))
);
--> statement-breakpoint
ALTER TABLE "badges"."batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "badges"."template_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"design" jsonb NOT NULL,
	"created_by" uuid,
	CONSTRAINT "template_versions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "template_versions_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE "badges"."template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."template_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "badges"."templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "templates_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "templates_name_length_check" CHECK (char_length(name) between 1 and 80),
	CONSTRAINT "templates_size_check" CHECK (size in ('fold_4x3', 'label_4x6', 'cr80', 'brother_62', 'brother_4in')),
	CONSTRAINT "templates_version_check" CHECK (current_version >= 1)
);
--> statement-breakpoint
ALTER TABLE "badges"."templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "badges"."assignments" ADD CONSTRAINT "assignments_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "badges"."templates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges"."batch_parts" ADD CONSTRAINT "batch_parts_batch_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "badges"."batches"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges"."template_versions" ADD CONSTRAINT "template_versions_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "badges"."templates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_org_id_idx" ON "badges"."assignments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "assignments_org_event_idx" ON "badges"."assignments" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "assignments_org_template_idx" ON "badges"."assignments" USING btree ("org_id","template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_org_ticket_type_key" ON "badges"."assignments" USING btree ("org_id","ticket_type_id") WHERE ticket_type_id is not null;--> statement-breakpoint
CREATE INDEX "batch_parts_org_id_idx" ON "badges"."batch_parts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_parts_org_batch_seq_key" ON "badges"."batch_parts" USING btree ("org_id","batch_id","seq");--> statement-breakpoint
CREATE INDEX "batches_org_id_idx" ON "badges"."batches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "batches_org_event_idx" ON "badges"."batches" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "batches_org_status_idx" ON "badges"."batches" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "batches_org_request_key" ON "badges"."batches" USING btree ("org_id","request_key");--> statement-breakpoint
CREATE INDEX "template_versions_org_id_idx" ON "badges"."template_versions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_org_template_version_key" ON "badges"."template_versions" USING btree ("org_id","template_id","version");--> statement-breakpoint
CREATE INDEX "templates_org_id_idx" ON "badges"."templates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "templates_org_event_idx" ON "badges"."templates" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_org_event_name_key" ON "badges"."templates" USING btree ("org_id","event_id",lower(name));--> statement-breakpoint
CREATE UNIQUE INDEX "templates_org_event_default_key" ON "badges"."templates" USING btree ("org_id","event_id") WHERE is_default;--> statement-breakpoint
CREATE POLICY "assignments_tenant_isolation" ON "badges"."assignments" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "batch_parts_tenant_isolation" ON "badges"."batch_parts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "batches_tenant_isolation" ON "badges"."batches" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "template_versions_tenant_isolation" ON "badges"."template_versions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "templates_tenant_isolation" ON "badges"."templates" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- Cross-module FKs, down the tiers (badges 5 → events 2, ticketing 3); new tables, so no NOT VALID needed.
ALTER TABLE "badges"."templates" ADD CONSTRAINT "templates_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "badges"."assignments" ADD CONSTRAINT "assignments_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "badges"."assignments" ADD CONSTRAINT "assignments_ticket_type_fk" FOREIGN KEY ("org_id","ticket_type_id") REFERENCES "ticketing"."ticket_types"("org_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "badges"."batches" ADD CONSTRAINT "batches_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
