CREATE TABLE "program"."booth_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"booth_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "booth_assignments_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "program"."booth_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."booth_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."booths" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"number" text NOT NULL,
	"category" text,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	CONSTRAINT "booths_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "booths_number_check" CHECK (char_length(number) between 1 and 20),
	CONSTRAINT "booths_category_check" CHECK (category is null or char_length(category) between 1 and 40),
	CONSTRAINT "booths_position_check" CHECK (x between 0 and 100000 and y between 0 and 100000),
	CONSTRAINT "booths_size_check" CHECK (width between 50 and 10000 and height between 50 and 10000)
);
--> statement-breakpoint
ALTER TABLE "program"."booths" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."booths" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."exhibitor_profile_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"account_id" uuid,
	"proposed" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "exhibitor_profile_changes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "exhibitor_profile_changes_status_check" CHECK (status in ('pending', 'approved', 'rejected')),
	CONSTRAINT "exhibitor_profile_changes_proposed_check" CHECK (jsonb_typeof(proposed) = 'object'),
	CONSTRAINT "exhibitor_profile_changes_reason_check" CHECK (reason is null or char_length(reason) <= 500)
);
--> statement-breakpoint
ALTER TABLE "program"."exhibitor_profile_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_profile_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."exhibitor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"listed" boolean DEFAULT true NOT NULL,
	"staff_allowance" integer,
	CONSTRAINT "exhibitor_profiles_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "exhibitor_profiles_allowance_check" CHECK (staff_allowance is null or staff_allowance between 0 and 500),
	CONSTRAINT "exhibitor_profiles_categories_check" CHECK (cardinality(categories) <= 5),
	CONSTRAINT "exhibitor_profiles_links_check" CHECK (jsonb_typeof(links) = 'array')
);
--> statement-breakpoint
ALTER TABLE "program"."exhibitor_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."exhibitor_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"default_staff_allowance" integer DEFAULT 5 NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	CONSTRAINT "exhibitor_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "exhibitor_settings_allowance_check" CHECK (default_staff_allowance between 0 and 500)
);
--> statement-breakpoint
ALTER TABLE "program"."exhibitor_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."booth_assignments" ADD CONSTRAINT "booth_assignments_booth_fk" FOREIGN KEY ("org_id","booth_id") REFERENCES "program"."booths"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."booth_assignments" ADD CONSTRAINT "booth_assignments_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_profile_changes" ADD CONSTRAINT "exhibitor_profile_changes_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_profiles" ADD CONSTRAINT "exhibitor_profiles_exhibitor_fk" FOREIGN KEY ("org_id","exhibitor_id") REFERENCES "program"."exhibitors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booth_assignments_org_id_idx" ON "program"."booth_assignments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booth_assignments_org_booth_exhibitor_key" ON "program"."booth_assignments" USING btree ("org_id","booth_id","exhibitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booth_assignments_org_booth_primary_key" ON "program"."booth_assignments" USING btree ("org_id","booth_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "booth_assignments_org_exhibitor_idx" ON "program"."booth_assignments" USING btree ("org_id","exhibitor_id");--> statement-breakpoint
CREATE INDEX "booth_assignments_org_event_idx" ON "program"."booth_assignments" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "booths_org_id_idx" ON "program"."booths" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booths_org_event_number_key" ON "program"."booths" USING btree ("org_id","event_id",lower(number));--> statement-breakpoint
CREATE INDEX "exhibitor_profile_changes_org_id_idx" ON "program"."exhibitor_profile_changes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exhibitor_profile_changes_org_pending_key" ON "program"."exhibitor_profile_changes" USING btree ("org_id","exhibitor_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "exhibitor_profile_changes_org_event_idx" ON "program"."exhibitor_profile_changes" USING btree ("org_id","event_id","status");--> statement-breakpoint
CREATE INDEX "exhibitor_profiles_org_id_idx" ON "program"."exhibitor_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exhibitor_profiles_org_exhibitor_key" ON "program"."exhibitor_profiles" USING btree ("org_id","exhibitor_id");--> statement-breakpoint
CREATE INDEX "exhibitor_profiles_org_event_idx" ON "program"."exhibitor_profiles" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "exhibitor_settings_org_id_idx" ON "program"."exhibitor_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exhibitor_settings_org_event_key" ON "program"."exhibitor_settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "booth_assignments_tenant_isolation" ON "program"."booth_assignments" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "booths_tenant_isolation" ON "program"."booths" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "exhibitor_profile_changes_tenant_isolation" ON "program"."exhibitor_profile_changes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "exhibitor_profiles_tenant_isolation" ON "program"."exhibitor_profiles" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "exhibitor_settings_tenant_isolation" ON "program"."exhibitor_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M5.4a cross-module composite FKs (program is tier 3, events tier 2): every new program row belongs to one event of the org.
ALTER TABLE "program"."exhibitor_settings" ADD CONSTRAINT "exhibitor_settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_profiles" ADD CONSTRAINT "exhibitor_profiles_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."exhibitor_profile_changes" ADD CONSTRAINT "exhibitor_profile_changes_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."booths" ADD CONSTRAINT "booths_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "program"."booth_assignments" ADD CONSTRAINT "booth_assignments_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
