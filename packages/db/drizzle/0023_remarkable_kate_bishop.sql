CREATE TABLE "attendees"."import_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"headers" text[] NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extra_labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"row_count" integer NOT NULL,
	"validated_at" timestamp with time zone,
	"uploaded_by" uuid,
	CONSTRAINT "import_batches_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "attendees"."import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendees"."import_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendees"."import_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"cells" text[] NOT NULL,
	"error_code" text,
	"attendee_id" uuid,
	CONSTRAINT "import_rows_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "attendees"."import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendees"."import_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendees"."import_rows" ADD CONSTRAINT "import_rows_batch_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "attendees"."import_batches"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_org_id_idx" ON "attendees"."import_batches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "import_batches_org_event_idx" ON "attendees"."import_batches" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "import_rows_org_id_idx" ON "attendees"."import_rows" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_org_batch_row_key" ON "attendees"."import_rows" USING btree ("org_id","batch_id","row_no");--> statement-breakpoint
CREATE POLICY "import_batches_tenant_isolation" ON "attendees"."import_batches" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "import_rows_tenant_isolation" ON "attendees"."import_rows" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
ALTER TABLE "attendees"."import_batches" ADD CONSTRAINT "import_batches_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "attendees"."import_rows" ADD CONSTRAINT "import_rows_attendee_fk" FOREIGN KEY ("org_id","attendee_id") REFERENCES "attendees"."attendees"("org_id","id") ON DELETE SET NULL ("attendee_id");
