CREATE TABLE "cms"."platform_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_assets_kind_check" CHECK (kind in ('image', 'video')),
	CONSTRAINT "platform_assets_type_check" CHECK (content_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
	CONSTRAINT "platform_assets_size_check" CHECK (size between 1 and 31457280)
);
--> statement-breakpoint
CREATE TABLE "cms"."platform_hero" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"headline" text,
	"subtitle" text,
	"image_asset_id" uuid,
	"video_asset_id" uuid,
	"video_url" text,
	"cta_label" text,
	"cta_href" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "platform_hero_singleton_check" CHECK (singleton),
	CONSTRAINT "platform_hero_headline_check" CHECK (headline is null or char_length(headline) <= 120),
	CONSTRAINT "platform_hero_subtitle_check" CHECK (subtitle is null or char_length(subtitle) <= 300),
	CONSTRAINT "platform_hero_cta_check" CHECK ((cta_label is null) = (cta_href is null)),
	CONSTRAINT "platform_hero_cta_href_check" CHECK (cta_href is null or cta_href ~ '^(/|https://)')
);
--> statement-breakpoint
CREATE TABLE "cms"."platform_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"cover_asset_id" uuid,
	"seo_title" text,
	"seo_description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "platform_posts_slug_check" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' and char_length(slug) <= 80),
	CONSTRAINT "platform_posts_title_check" CHECK (char_length(title) between 1 and 160),
	CONSTRAINT "platform_posts_excerpt_check" CHECK (char_length(excerpt) <= 400),
	CONSTRAINT "platform_posts_body_check" CHECK (char_length(body) <= 50000),
	CONSTRAINT "platform_posts_seo_check" CHECK ((seo_title is null or char_length(seo_title) <= 70) and (seo_description is null or char_length(seo_description) <= 200)),
	CONSTRAINT "platform_posts_status_check" CHECK (status in ('draft', 'published')),
	CONSTRAINT "platform_posts_published_check" CHECK ((status = 'published') = (published_at is not null))
);
--> statement-breakpoint
CREATE TABLE "cms"."platform_testimonials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quote" text NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"photo_asset_id" uuid,
	"rating" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "platform_testimonials_quote_check" CHECK (char_length(quote) between 1 and 600),
	CONSTRAINT "platform_testimonials_name_check" CHECK (char_length(name) between 1 and 120),
	CONSTRAINT "platform_testimonials_role_check" CHECK (role is null or char_length(role) <= 160),
	CONSTRAINT "platform_testimonials_rating_check" CHECK (rating is null or rating between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_posts_slug_key" ON "cms"."platform_posts" USING btree ("slug");
--> statement-breakpoint
-- hand-written: begin (platform blog, testimonials and home hero, managed by staff in the admin console)
-- app_user reads only the public views (published rows); staff write through the functions below
-- (platform_reader, audited by platform.access_log). The views run with their owner's rights.
REVOKE ALL ON cms.platform_assets, cms.platform_posts, cms.platform_testimonials, cms.platform_hero FROM app_user;--> statement-breakpoint
GRANT SELECT ON cms.platform_assets, cms.platform_posts, cms.platform_testimonials, cms.platform_hero TO platform_reader;--> statement-breakpoint
CREATE VIEW cms.public_platform_posts AS
  SELECT slug, title, excerpt, body, cover_asset_id, seo_title, seo_description, published_at, updated_at, author_name
  FROM cms.platform_posts WHERE status = 'published';--> statement-breakpoint
CREATE VIEW cms.public_platform_testimonials AS
  SELECT id, quote, name, role, photo_asset_id, rating, position
  FROM cms.platform_testimonials WHERE published;--> statement-breakpoint
CREATE VIEW cms.public_platform_hero AS
  SELECT headline, subtitle, image_asset_id, video_asset_id, video_url, cta_label, cta_href FROM cms.platform_hero;--> statement-breakpoint
CREATE VIEW cms.public_platform_assets AS
  SELECT id, kind, content_type, size, sha256, bytes FROM cms.platform_assets;--> statement-breakpoint
GRANT SELECT ON cms.public_platform_posts, cms.public_platform_testimonials, cms.public_platform_hero, cms.public_platform_assets TO app_user;--> statement-breakpoint
CREATE FUNCTION cms.platform_store_asset(p_kind text, p_type text, p_bytes bytea, p_sha text, p_actor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_store_asset: a staff actor is required'; END IF;
  INSERT INTO cms.platform_assets (kind, content_type, bytes, size, sha256, created_by)
  VALUES (p_kind, p_type, p_bytes, octet_length(p_bytes), p_sha, p_actor) RETURNING id INTO v_id;
  RETURN v_id;
END $$;--> statement-breakpoint
CREATE FUNCTION cms.platform_save_post(p jsonb, p_actor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid; v_status text := coalesce(p->>'status', 'draft'); v_pub timestamptz;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_save_post: a staff actor is required'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO cms.platform_posts (slug, title, excerpt, body, cover_asset_id, seo_title, seo_description, status, published_at, author_name, updated_by)
    VALUES (p->>'slug', p->>'title', coalesce(p->>'excerpt', ''), coalesce(p->>'body', ''), nullif(p->>'coverAssetId', '')::uuid,
            nullif(p->>'seoTitle', ''), nullif(p->>'seoDescription', ''), v_status,
            CASE WHEN v_status = 'published' THEN now() END, nullif(p->>'authorName', ''), p_actor)
    RETURNING id INTO v_id;
  ELSE
    SELECT published_at INTO v_pub FROM cms.platform_posts WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'platform_save_post: unknown post'; END IF;
    UPDATE cms.platform_posts SET slug = p->>'slug', title = p->>'title', excerpt = coalesce(p->>'excerpt', ''),
      body = coalesce(p->>'body', ''), cover_asset_id = nullif(p->>'coverAssetId', '')::uuid,
      seo_title = nullif(p->>'seoTitle', ''), seo_description = nullif(p->>'seoDescription', ''), status = v_status,
      published_at = CASE WHEN v_status = 'published' THEN coalesce(v_pub, now()) END,
      author_name = nullif(p->>'authorName', ''), updated_at = now(), updated_by = p_actor
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;--> statement-breakpoint
CREATE FUNCTION cms.platform_delete_post(p_id uuid, p_actor text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_delete_post: a staff actor is required'; END IF;
  DELETE FROM cms.platform_posts WHERE id = p_id;
  RETURN FOUND;
END $$;--> statement-breakpoint
CREATE FUNCTION cms.platform_save_testimonial(p jsonb, p_actor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_save_testimonial: a staff actor is required'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO cms.platform_testimonials (quote, name, role, photo_asset_id, rating, position, published, updated_by)
    VALUES (p->>'quote', p->>'name', nullif(p->>'role', ''), nullif(p->>'photoAssetId', '')::uuid,
            nullif(p->>'rating', '')::int, coalesce((p->>'position')::int, 0), coalesce((p->>'published')::boolean, false), p_actor)
    RETURNING id INTO v_id;
  ELSE
    UPDATE cms.platform_testimonials SET quote = p->>'quote', name = p->>'name', role = nullif(p->>'role', ''),
      photo_asset_id = nullif(p->>'photoAssetId', '')::uuid, rating = nullif(p->>'rating', '')::int,
      position = coalesce((p->>'position')::int, 0), published = coalesce((p->>'published')::boolean, false),
      updated_at = now(), updated_by = p_actor
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'platform_save_testimonial: unknown testimonial'; END IF;
  END IF;
  RETURN v_id;
END $$;--> statement-breakpoint
CREATE FUNCTION cms.platform_delete_testimonial(p_id uuid, p_actor text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_delete_testimonial: a staff actor is required'; END IF;
  DELETE FROM cms.platform_testimonials WHERE id = p_id;
  RETURN FOUND;
END $$;--> statement-breakpoint
CREATE FUNCTION cms.platform_save_hero(p jsonb, p_actor text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_save_hero: a staff actor is required'; END IF;
  INSERT INTO cms.platform_hero (singleton, headline, subtitle, image_asset_id, video_asset_id, video_url, cta_label, cta_href, updated_by)
  VALUES (true, nullif(p->>'headline', ''), nullif(p->>'subtitle', ''), nullif(p->>'imageAssetId', '')::uuid,
          nullif(p->>'videoAssetId', '')::uuid, nullif(p->>'videoUrl', ''), nullif(p->>'ctaLabel', ''), nullif(p->>'ctaHref', ''), p_actor)
  ON CONFLICT (singleton) DO UPDATE SET headline = excluded.headline, subtitle = excluded.subtitle,
    image_asset_id = excluded.image_asset_id, video_asset_id = excluded.video_asset_id, video_url = excluded.video_url,
    cta_label = excluded.cta_label, cta_href = excluded.cta_href, updated_at = now(), updated_by = p_actor;
  RETURN true;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION cms.platform_store_asset(text, text, bytea, text, text), cms.platform_save_post(jsonb, text),
  cms.platform_delete_post(uuid, text), cms.platform_save_testimonial(jsonb, text),
  cms.platform_delete_testimonial(uuid, text), cms.platform_save_hero(jsonb, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION cms.platform_store_asset(text, text, bytea, text, text), cms.platform_save_post(jsonb, text),
  cms.platform_delete_post(uuid, text), cms.platform_save_testimonial(jsonb, text),
  cms.platform_delete_testimonial(uuid, text), cms.platform_save_hero(jsonb, text) TO platform_reader;
-- hand-written: end
