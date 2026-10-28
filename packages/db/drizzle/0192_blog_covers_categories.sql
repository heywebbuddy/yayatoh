CREATE TABLE "cms"."entry_covers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	CONSTRAINT "entry_covers_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "entry_covers_type_check" CHECK (content_type in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "entry_covers_size_check" CHECK (size between 1 and 5242880)
);
--> statement-breakpoint
ALTER TABLE "cms"."entry_covers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms"."entries" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "cms"."entries" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "cms"."entries" ADD COLUMN "cover_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "cms"."entries" ADD COLUMN "cover_alt" text;--> statement-breakpoint
ALTER TABLE "cms"."platform_posts" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "cms"."platform_posts" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "cms"."platform_posts" ADD COLUMN "cover_alt" text;--> statement-breakpoint
CREATE INDEX "entry_covers_org_id_idx" ON "cms"."entry_covers" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "cms"."entries" ADD CONSTRAINT "entries_cover_fk" FOREIGN KEY ("org_id","cover_asset_id") REFERENCES "cms"."entry_covers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms"."entries" ADD CONSTRAINT "entries_category_check" CHECK (category is null or char_length(category) between 1 and 40);--> statement-breakpoint
ALTER TABLE "cms"."entries" ADD CONSTRAINT "entries_tags_check" CHECK (cardinality(tags) <= 6);--> statement-breakpoint
ALTER TABLE "cms"."entries" ADD CONSTRAINT "entries_cover_alt_check" CHECK (cover_asset_id is null or (cover_alt is not null and char_length(btrim(cover_alt)) between 1 and 300));--> statement-breakpoint
ALTER TABLE "cms"."platform_posts" ADD CONSTRAINT "platform_posts_category_check" CHECK (category is null or char_length(category) between 1 and 40);--> statement-breakpoint
ALTER TABLE "cms"."platform_posts" ADD CONSTRAINT "platform_posts_tags_check" CHECK (cardinality(tags) <= 6);--> statement-breakpoint
CREATE POLICY "entry_covers_tenant_isolation" ON "cms"."entry_covers" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin (platform blog: category, tags and the cover's alt text reach the public view and the staff save function)
CREATE OR REPLACE VIEW cms.public_platform_posts AS
  SELECT slug, title, excerpt, body, cover_asset_id, seo_title, seo_description, published_at, updated_at, author_name,
         category, tags, cover_alt
  FROM cms.platform_posts WHERE status = 'published';--> statement-breakpoint
CREATE OR REPLACE FUNCTION cms.platform_save_post(p jsonb, p_actor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid; v_status text := coalesce(p->>'status', 'draft'); v_pub timestamptz;
        v_tags text[] := ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)));
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_save_post: a staff actor is required'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO cms.platform_posts (slug, title, excerpt, body, cover_asset_id, cover_alt, seo_title, seo_description, status, published_at, author_name, category, tags, updated_by)
    VALUES (p->>'slug', p->>'title', coalesce(p->>'excerpt', ''), coalesce(p->>'body', ''), nullif(p->>'coverAssetId', '')::uuid, nullif(p->>'coverAlt', ''),
            nullif(p->>'seoTitle', ''), nullif(p->>'seoDescription', ''), v_status,
            CASE WHEN v_status = 'published' THEN coalesce(nullif(p->>'publishedAt', '')::timestamptz, now()) END,
            nullif(p->>'authorName', ''), nullif(p->>'category', ''), v_tags, p_actor)
    RETURNING id INTO v_id;
  ELSE
    SELECT published_at INTO v_pub FROM cms.platform_posts WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'platform_save_post: unknown post'; END IF;
    UPDATE cms.platform_posts SET slug = p->>'slug', title = p->>'title', excerpt = coalesce(p->>'excerpt', ''),
      body = coalesce(p->>'body', ''), cover_asset_id = nullif(p->>'coverAssetId', '')::uuid, cover_alt = nullif(p->>'coverAlt', ''),
      seo_title = nullif(p->>'seoTitle', ''), seo_description = nullif(p->>'seoDescription', ''), status = v_status,
      published_at = CASE WHEN v_status = 'published' THEN coalesce(v_pub, nullif(p->>'publishedAt', '')::timestamptz, now()) END,
      author_name = nullif(p->>'authorName', ''), category = nullif(p->>'category', ''), tags = v_tags,
      updated_at = now(), updated_by = p_actor
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;
-- hand-written: end
