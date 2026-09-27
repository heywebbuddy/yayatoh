CREATE TABLE "platform"."bulk_operation_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"ok" boolean NOT NULL,
	"error_code" text,
	"undo" jsonb,
	"undone_at" timestamp with time zone,
	CONSTRAINT "bulk_operation_items_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "platform"."bulk_operation_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."bulk_operation_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."bulk_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"event_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"item_ids" uuid[] NOT NULL,
	"total" integer NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"undone" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"file_id" uuid,
	"undo_until" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "bulk_operations_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "bulk_operations_status_check" CHECK (status in ('queued', 'running', 'done', 'failed', 'undoing', 'undone')),
	CONSTRAINT "bulk_operations_counts_check" CHECK (processed <= total and succeeded + failed <= processed)
);
--> statement-breakpoint
ALTER TABLE "platform"."bulk_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."bulk_operations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."file_parts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "file_parts_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "platform"."file_parts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."file_parts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "files_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "platform"."files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."bulk_operation_items" ADD CONSTRAINT "bulk_operation_items_operation_fk" FOREIGN KEY ("org_id","operation_id") REFERENCES "platform"."bulk_operations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."file_parts" ADD CONSTRAINT "file_parts_file_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "platform"."files"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_operation_items_org_id_idx" ON "platform"."bulk_operation_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_operation_items_org_op_item_key" ON "platform"."bulk_operation_items" USING btree ("org_id","operation_id","item_id");--> statement-breakpoint
CREATE INDEX "bulk_operations_org_id_idx" ON "platform"."bulk_operations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "bulk_operations_org_created_idx" ON "platform"."bulk_operations" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "bulk_operations_active_idx" ON "platform"."bulk_operations" USING btree ("org_id","id") WHERE status in ('queued', 'running', 'undoing');--> statement-breakpoint
CREATE INDEX "file_parts_org_id_idx" ON "platform"."file_parts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_parts_org_file_seq_key" ON "platform"."file_parts" USING btree ("org_id","file_id","seq");--> statement-breakpoint
CREATE INDEX "files_org_id_idx" ON "platform"."files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "files_org_expires_idx" ON "platform"."files" USING btree ("org_id","expires_at");--> statement-breakpoint
CREATE POLICY "bulk_operation_items_tenant_isolation" ON "platform"."bulk_operation_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "bulk_operations_tenant_isolation" ON "platform"."bulk_operations" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "file_parts_tenant_isolation" ON "platform"."file_parts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "files_tenant_isolation" ON "platform"."files" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
ALTER TABLE "platform"."bulk_operations" ADD CONSTRAINT "bulk_operations_file_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "platform"."files"("org_id","id");--> statement-breakpoint
-- The worker finds operations to run across orgs (allowlisted columns only), then runs each
-- under its own org's RLS.
CREATE FUNCTION platform.due_bulk_operations(p_limit integer)
RETURNS TABLE (org_id uuid, operation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.org_id, b.id FROM platform.bulk_operations b
  WHERE b.status IN ('queued', 'running', 'undoing')
  ORDER BY b.id
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.due_bulk_operations(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.due_bulk_operations(integer) TO platform_reader;
