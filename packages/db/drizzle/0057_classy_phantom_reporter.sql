CREATE SCHEMA "cms";
--> statement-breakpoint
CREATE SCHEMA "reviews";
--> statement-breakpoint
CREATE TABLE "cms"."entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"seo_title" text,
	"seo_description" text,
	"author_user_id" uuid,
	"author_name" text,
	CONSTRAINT "entries_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "entries_kind_check" CHECK (kind in ('page', 'post')),
	CONSTRAINT "entries_status_check" CHECK (status in ('draft', 'published', 'archived')),
	CONSTRAINT "entries_slug_check" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
	CONSTRAINT "entries_title_check" CHECK (char_length(title) between 1 and 160),
	CONSTRAINT "entries_excerpt_check" CHECK (excerpt is null or char_length(excerpt) <= 300),
	CONSTRAINT "entries_body_check" CHECK (char_length(body) <= 20000),
	CONSTRAINT "entries_seo_title_check" CHECK (seo_title is null or char_length(seo_title) <= 70),
	CONSTRAINT "entries_seo_description_check" CHECK (seo_description is null or char_length(seo_description) <= 160),
	CONSTRAINT "entries_published_at_check" CHECK (status <> 'published' or published_at is not null)
);
--> statement-breakpoint
ALTER TABLE "cms"."entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms"."entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reviews"."review_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"reporter_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "review_reports_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "review_reports_reason_check" CHECK (reason in ('spam', 'offensive', 'off_topic', 'personal_info', 'other')),
	CONSTRAINT "review_reports_status_check" CHECK (status in ('open', 'dismissed', 'actioned')),
	CONSTRAINT "review_reports_note_check" CHECK (note is null or char_length(note) <= 500)
);
--> statement-breakpoint
ALTER TABLE "reviews"."review_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reviews"."review_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reviews"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"author_key" text NOT NULL,
	"author_display" text,
	"rating" smallint NOT NULL,
	"body" text,
	"status" text DEFAULT 'visible' NOT NULL,
	"hidden_reason" text,
	"moderated_at" timestamp with time zone,
	"moderated_by" text,
	CONSTRAINT "reviews_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "reviews_rating_check" CHECK (rating between 1 and 5),
	CONSTRAINT "reviews_body_check" CHECK (body is null or char_length(body) between 1 and 1000),
	CONSTRAINT "reviews_status_check" CHECK (status in ('visible', 'hidden')),
	CONSTRAINT "reviews_hidden_reason_check" CHECK ((status = 'hidden') = (hidden_reason is not null) and (hidden_reason is null or char_length(hidden_reason) <= 300))
);
--> statement-breakpoint
ALTER TABLE "reviews"."reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reviews"."reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketplace"."site_settings" ADD COLUMN "nav_page_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews"."review_reports" ADD CONSTRAINT "review_reports_review_fk" FOREIGN KEY ("org_id","review_id") REFERENCES "reviews"."reviews"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_org_id_idx" ON "cms"."entries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_org_kind_slug_key" ON "cms"."entries" USING btree ("org_id","kind","slug");--> statement-breakpoint
CREATE INDEX "entries_org_kind_status_published_idx" ON "cms"."entries" USING btree ("org_id","kind","status","published_at");--> statement-breakpoint
CREATE INDEX "review_reports_org_id_idx" ON "reviews"."review_reports" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_org_review_reporter_key" ON "reviews"."review_reports" USING btree ("org_id","review_id","reporter_key");--> statement-breakpoint
CREATE INDEX "review_reports_org_status_idx" ON "reviews"."review_reports" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "reviews_org_id_idx" ON "reviews"."reviews" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_org_event_author_key" ON "reviews"."reviews" USING btree ("org_id","event_id","author_key");--> statement-breakpoint
CREATE INDEX "reviews_org_event_status_created_idx" ON "reviews"."reviews" USING btree ("org_id","event_id","status","created_at");--> statement-breakpoint
CREATE INDEX "reviews_org_order_idx" ON "reviews"."reviews" USING btree ("org_id","order_id");--> statement-breakpoint
-- hand-written: begin (M1.4g: CHECK on an existing table, NOT VALID then VALIDATE)
ALTER TABLE "marketplace"."site_settings" ADD CONSTRAINT "site_settings_nav_page_ids_check" CHECK (cardinality(nav_page_ids) <= 8) NOT VALID;--> statement-breakpoint
ALTER TABLE "marketplace"."site_settings" VALIDATE CONSTRAINT "site_settings_nav_page_ids_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "entries_tenant_isolation" ON "cms"."entries" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "review_reports_tenant_isolation" ON "reviews"."review_reports" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "reviews_tenant_isolation" ON "reviews"."reviews" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M1.4g: org and cross-module foreign keys; new tables, so no NOT VALID needed)
-- cms (tier 1) → tenancy (tier 1): the org foreign key, as for venues in M1.4c.
ALTER TABLE "cms"."entries" ADD CONSTRAINT "entries_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
-- reviews (tier 5) → tenancy, events (tier 2) and orders (tier 4): composite keys down the tiers.
ALTER TABLE "reviews"."reviews" ADD CONSTRAINT "reviews_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "reviews"."reviews" ADD CONSTRAINT "reviews_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "reviews"."reviews" ADD CONSTRAINT "reviews_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "reviews"."review_reports" ADD CONSTRAINT "review_reports_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;
-- hand-written: end
