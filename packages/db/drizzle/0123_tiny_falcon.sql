CREATE TABLE "events"."org_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform_key" text NOT NULL,
	"name" text,
	"position" integer NOT NULL,
	"hidden_at" timestamp with time zone,
	CONSTRAINT "org_categories_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "org_categories_platform_key_check" CHECK (platform_key in ('arts_culture', 'business_seminars', 'charity', 'community', 'education_classes', 'family', 'food_drink', 'health_wellness', 'music', 'nightlife', 'religion_spirituality', 'social_gatherings', 'sports_fitness', 'technology', 'travel_leisure', 'other')),
	CONSTRAINT "org_categories_name_check" CHECK (name is null or char_length(name) between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "events"."org_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."org_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."platform_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"in_defaults" boolean DEFAULT true NOT NULL,
	"updated_by" text DEFAULT 'migration' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_categories_key_check" CHECK (key in ('arts_culture', 'business_seminars', 'charity', 'community', 'education_classes', 'family', 'food_drink', 'health_wellness', 'music', 'nightlife', 'religion_spirituality', 'social_gatherings', 'sports_fitness', 'technology', 'travel_leisure', 'other'))
);
--> statement-breakpoint
ALTER TABLE "events"."events" ADD COLUMN "org_category_id" uuid;--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace"."public_listings" ADD COLUMN "tag_keys" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "org_categories_org_id_idx" ON "events"."org_categories" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_categories_org_id_position_idx" ON "events"."org_categories" USING btree ("org_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "org_categories_org_name_key" ON "events"."org_categories" USING btree ("org_id",lower("name")) WHERE name is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "org_categories_org_default_key" ON "events"."org_categories" USING btree ("org_id","platform_key") WHERE name is null;--> statement-breakpoint
-- hand-written: begin (U8: the FK on the existing events table added NOT VALID, then validated)
ALTER TABLE "events"."events" ADD CONSTRAINT "events_org_category_fk" FOREIGN KEY ("org_id","org_category_id") REFERENCES "events"."org_categories"("org_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "events"."events" VALIDATE CONSTRAINT "events_org_category_fk";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin
-- U8: an index on the existing events table. drizzle's migrator runs each migration in one
-- transaction, so CONCURRENTLY is not possible here: on a large production table the owner's
-- runbook creates it CONCURRENTLY first (same name) and this finds it (IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS "events_org_id_org_category_id_idx" ON "events"."events" USING btree ("org_id","org_category_id");--> statement-breakpoint
-- hand-written: end
CREATE POLICY "org_categories_tenant_isolation" ON "events"."org_categories" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- U8 (UX-2): the platform default category list is reference data. app_user only reads it; staff
-- change it in admin through events.set_platform_default_categories (platform_reader). Seeded with
-- the whole taxonomy (EVENT_CATEGORIES) in its code order, every key in the defaults.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON events.platform_categories FROM app_user;--> statement-breakpoint
GRANT SELECT ON events.platform_categories TO app_user;--> statement-breakpoint
GRANT SELECT ON events.platform_categories TO platform_reader;--> statement-breakpoint
INSERT INTO events.platform_categories (key, position) VALUES
  ('arts_culture', 0), ('business_seminars', 1), ('charity', 2), ('community', 3),
  ('education_classes', 4), ('family', 5), ('food_drink', 6), ('health_wellness', 7),
  ('music', 8), ('nightlife', 9), ('religion_spirituality', 10), ('social_gatherings', 11),
  ('sports_fitness', 12), ('technology', 13), ('travel_leisure', 14), ('other', 15)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
-- The staff save: p_keys are the default list in order (each a taxonomy key, at most once, at
-- least one); every other key stays in the table, out of the defaults, after them. Orgs that
-- already have their own list keep it. Returns how many keys are in the defaults.
CREATE FUNCTION events.set_platform_default_categories(p_keys text[], p_actor text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  n integer := coalesce(array_length(p_keys, 1), 0);
BEGIN
  IF n = 0 THEN
    RAISE EXCEPTION 'set_platform_default_categories: keep at least one category';
  END IF;
  IF (SELECT count(DISTINCT k) FROM unnest(p_keys) AS k) <> n THEN
    RAISE EXCEPTION 'set_platform_default_categories: a key is listed twice';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_keys) AS k WHERE k NOT IN (SELECT key FROM events.platform_categories)) THEN
    RAISE EXCEPTION 'set_platform_default_categories: unknown key';
  END IF;
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN
    RAISE EXCEPTION 'set_platform_default_categories: a staff actor is required';
  END IF;
  UPDATE events.platform_categories c SET
    in_defaults = x.ord IS NOT NULL,
    position = coalesce(x.ord - 1, n + r.rest),
    updated_by = p_actor,
    updated_at = now()
  FROM (
    SELECT key, row_number() OVER (ORDER BY position, key) AS rest FROM events.platform_categories
  ) r
  LEFT JOIN unnest(p_keys) WITH ORDINALITY AS x(key, ord) ON x.key = r.key
  WHERE c.key = r.key;
  RETURN n;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.set_platform_default_categories(text[], text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.set_platform_default_categories(text[], text) TO platform_reader;
-- hand-written: end
