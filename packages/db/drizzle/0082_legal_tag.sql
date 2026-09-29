CREATE TABLE "guests"."import_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"source" text NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"sheet" text,
	"sheets" text[] DEFAULT '{}'::text[] NOT NULL,
	"headers_ciphertext" text,
	"column_count" integer NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"parties_planned" integer DEFAULT 0 NOT NULL,
	"guests_planned" integer DEFAULT 0 NOT NULL,
	"parties_imported" integer DEFAULT 0 NOT NULL,
	"guests_imported" integer DEFAULT 0 NOT NULL,
	"validated_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone,
	"uploaded_by" uuid,
	CONSTRAINT "import_batches_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "import_batches_source_check" CHECK (source in ('paste', 'csv', 'xlsx', 'sheet')),
	CONSTRAINT "import_batches_status_check" CHECK (status in ('staged', 'validated', 'importing', 'imported')),
	CONSTRAINT "import_batches_file_name_length" CHECK (length(file_name) <= 200),
	CONSTRAINT "import_batches_sheet_length" CHECK (sheet is null or length(sheet) between 1 and 200),
	CONSTRAINT "import_batches_sheets_check" CHECK (cardinality(sheets) <= 100),
	CONSTRAINT "import_batches_columns_check" CHECK (column_count between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "guests"."import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."import_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."import_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"cells_ciphertext" text,
	"error_code" text,
	"planned_party_id" uuid,
	"imported_at" timestamp with time zone,
	CONSTRAINT "import_rows_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "import_rows_error_length" CHECK (error_code is null or length(error_code) between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "guests"."import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."import_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."import_rows" ADD CONSTRAINT "import_rows_batch_fk" FOREIGN KEY ("org_id","batch_id") REFERENCES "guests"."import_batches"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_org_id_idx" ON "guests"."import_batches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "import_batches_org_event_idx" ON "guests"."import_batches" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "import_batches_org_expiry_idx" ON "guests"."import_batches" USING btree ("org_id","expires_at") WHERE purged_at is null;--> statement-breakpoint
CREATE INDEX "import_rows_org_id_idx" ON "guests"."import_rows" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_org_batch_row_key" ON "guests"."import_rows" USING btree ("org_id","batch_id","row_no");--> statement-breakpoint
CREATE INDEX "import_rows_org_planned_idx" ON "guests"."import_rows" USING btree ("org_id","planned_party_id") WHERE planned_party_id is not null;--> statement-breakpoint
CREATE POLICY "import_batches_tenant_isolation" ON "guests"."import_batches" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "import_rows_tenant_isolation" ON "guests"."import_rows" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.1b cross-module composite FK (guests is tier 3, events tier 2): an import belongs to one
-- event of the org and goes with it (its rows follow through import_rows_batch_fk).
ALTER TABLE "guests"."import_batches" ADD CONSTRAINT "import_batches_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
