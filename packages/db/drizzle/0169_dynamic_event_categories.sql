ALTER TABLE events.platform_categories DROP CONSTRAINT platform_categories_key_check;
--> statement-breakpoint
ALTER TABLE events.platform_categories ADD COLUMN label text;
--> statement-breakpoint
ALTER TABLE events.platform_categories ADD CONSTRAINT platform_categories_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,59}$');
--> statement-breakpoint
ALTER TABLE events.platform_categories ADD CONSTRAINT platform_categories_label_check CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 60);
--> statement-breakpoint
CREATE UNIQUE INDEX platform_categories_label_unique ON events.platform_categories (lower(label)) WHERE label IS NOT NULL;
--> statement-breakpoint
ALTER TABLE events.events DROP CONSTRAINT events_category_check;
--> statement-breakpoint
ALTER TABLE events.events ADD CONSTRAINT events_category_fk FOREIGN KEY (category) REFERENCES events.platform_categories(key) NOT VALID;
--> statement-breakpoint
ALTER TABLE events.events VALIDATE CONSTRAINT events_category_fk;
--> statement-breakpoint
ALTER TABLE events.org_categories DROP CONSTRAINT org_categories_platform_key_check;
--> statement-breakpoint
ALTER TABLE events.org_categories ADD CONSTRAINT org_categories_platform_key_fk FOREIGN KEY (platform_key) REFERENCES events.platform_categories(key) NOT VALID;
--> statement-breakpoint
ALTER TABLE events.org_categories VALIDATE CONSTRAINT org_categories_platform_key_fk;
--> statement-breakpoint
CREATE FUNCTION events.create_platform_category(p_key text, p_label text, p_include boolean, p_actor text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_position integer;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'A staff actor is required'; END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{0,59}$' OR p_label IS NULL
    OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 60 OR p_include IS NULL THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('events.platform_categories'));
  SELECT coalesce(max(position), -1) + 1 INTO v_position FROM events.platform_categories;
  INSERT INTO events.platform_categories(key, label, position, in_defaults, updated_by)
    VALUES (p_key, btrim(p_label), v_position, p_include, p_actor);
  RETURN p_key;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION events.create_platform_category(text, text, boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.create_platform_category(text, text, boolean, text) TO platform_reader;
