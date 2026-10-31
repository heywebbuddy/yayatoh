DROP INDEX "cms"."platform_pages_slug_key";--> statement-breakpoint
ALTER TABLE "cms"."platform_pages" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_pages_slug_locale_key" ON "cms"."platform_pages" USING btree ("slug","locale");--> statement-breakpoint
ALTER TABLE "cms"."platform_pages" ADD CONSTRAINT "platform_pages_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$');--> statement-breakpoint
-- hand-written: begin (site pages per language: the public view carries the locale, the save function takes it)
DROP VIEW cms.public_platform_pages;--> statement-breakpoint
CREATE VIEW cms.public_platform_pages AS
  SELECT slug, locale, title, body, effective_date, version, published_at, updated_at FROM cms.platform_pages WHERE status = 'published';--> statement-breakpoint
GRANT SELECT ON cms.public_platform_pages TO app_user;--> statement-breakpoint
CREATE OR REPLACE FUNCTION cms.platform_save_page(p jsonb, p_actor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid; v_ver int; v_status text := coalesce(p->>'status', 'draft'); v_pub timestamptz; v_loc text := coalesce(nullif(p->>'locale', ''), 'en');
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_save_page: a staff actor is required'; END IF;
  SELECT id, version, published_at INTO v_id, v_ver, v_pub FROM cms.platform_pages WHERE slug = p->>'slug' AND locale = v_loc FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO cms.platform_pages (slug, locale, title, body, effective_date, status, version, published_at, updated_by)
    VALUES (p->>'slug', v_loc, p->>'title', coalesce(p->>'body', ''), (p->>'effectiveDate')::date, v_status, 1,
            CASE WHEN v_status = 'published' THEN now() END, p_actor)
    RETURNING id, version INTO v_id, v_ver;
  ELSE
    v_ver := v_ver + 1;
    UPDATE cms.platform_pages SET title = p->>'title', body = coalesce(p->>'body', ''), effective_date = (p->>'effectiveDate')::date,
      status = v_status, version = v_ver, published_at = CASE WHEN v_status = 'published' THEN coalesce(v_pub, now()) END,
      updated_at = now(), updated_by = p_actor
    WHERE id = v_id;
  END IF;
  INSERT INTO cms.platform_page_versions (page_id, version, title, body, effective_date, status, saved_by)
  VALUES (v_id, v_ver, p->>'title', coalesce(p->>'body', ''), (p->>'effectiveDate')::date, v_status, p_actor);
  RETURN v_id;
END $$;
-- hand-written: end
