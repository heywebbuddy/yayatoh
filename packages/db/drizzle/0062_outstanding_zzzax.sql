ALTER TABLE "media"."assets" DROP CONSTRAINT "assets_owner_type_check";--> statement-breakpoint
ALTER TABLE "media"."assets" DROP CONSTRAINT "assets_owner_slot_check";--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_speaker_photo_key" ON "media"."assets" USING btree ("org_id","owner_id") WHERE owner_type = 'speaker';--> statement-breakpoint
-- hand-written: begin (M1.4h: existing table, so the widened CHECKs are added NOT VALID, then validated)
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_owner_type_check" CHECK (owner_type in ('event', 'venue', 'org', 'speaker', 'exhibitor', 'sponsor')) NOT VALID;--> statement-breakpoint
ALTER TABLE "media"."assets" VALIDATE CONSTRAINT "assets_owner_type_check";--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_owner_slot_check" CHECK ((owner_type = 'event' and slot in ('cover', 'gallery')) or (owner_type = 'venue' and slot = 'photo') or (owner_type = 'org' and slot = 'logo' and owner_id = org_id) or (owner_type = 'speaker' and slot = 'photo') or (owner_type in ('exhibitor', 'sponsor') and slot = 'logo')) NOT VALID;--> statement-breakpoint
ALTER TABLE "media"."assets" VALIDATE CONSTRAINT "assets_owner_slot_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin (M1.4h: program images follow their event's visibility; allowlisted, SECURITY DEFINER)
-- The event an owner's images belong to: the event itself, or the event of a speaker, exhibitor
-- or sponsor row (null for venues, the org, and deleted rows).
CREATE FUNCTION media.owner_event(p_org uuid, p_owner_type text, p_owner_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE p_owner_type
    WHEN 'event' THEN p_owner_id
    WHEN 'speaker' THEN (SELECT s.event_id FROM program.speakers s WHERE s.org_id = p_org AND s.id = p_owner_id)
    WHEN 'exhibitor' THEN (SELECT x.event_id FROM program.exhibitors x WHERE x.org_id = p_org AND x.id = p_owner_id)
    WHEN 'sponsor' THEN (SELECT s.event_id FROM program.sponsors s WHERE s.org_id = p_org AND s.id = p_owner_id)
    ELSE NULL END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.owner_event(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.owner_event(uuid, text, uuid) TO app_user;--> statement-breakpoint
-- Who may see an owner's images (M1.4e), now also for program rows: a speaker's, exhibitor's or
-- sponsor's images are exactly as visible as their event (a deleted row: 'none').
CREATE OR REPLACE FUNCTION media.owner_visibility(p_org uuid, p_owner_type text, p_owner_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM tenancy.organizations o WHERE o.id = p_org AND o.status IN ('active', 'limited'))
      THEN 'none'
    WHEN p_owner_type = 'org' THEN CASE WHEN p_owner_id = p_org THEN 'public' ELSE 'none' END
    WHEN p_owner_type = 'venue' THEN coalesce((
      SELECT 'public' FROM venues.venues v
      WHERE v.org_id = p_org AND v.id = p_owner_id AND v.directory_listed AND v.archived_at IS NULL), 'none')
    WHEN p_owner_type IN ('event', 'speaker', 'exhibitor', 'sponsor') THEN coalesce((
      SELECT CASE
        WHEN e.status IN ('published', 'postponed', 'cancelled', 'completed') AND e.visibility IN ('public', 'unlisted')
          THEN 'public'
        WHEN e.status IN ('published', 'postponed') AND e.visibility = 'private' THEN 'private_event'
        ELSE 'none' END
      FROM events.events e
      WHERE e.org_id = p_org AND e.id = media.owner_event(p_org, p_owner_type, p_owner_id)), 'none')
    ELSE 'none' END
$$;--> statement-breakpoint
-- serve_target gains event_id (whose access grant opens a private image): a new result column
-- means drop and create (a function, no data).
DROP FUNCTION media.serve_target(uuid, uuid, text);--> statement-breakpoint
CREATE FUNCTION media.serve_target(p_org uuid, p_asset uuid, p_file text)
RETURNS TABLE (format text, bytes integer, sha256 text, owner_type text, owner_id uuid, visibility text, event_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.format, v.bytes, v.sha256, a.owner_type, a.owner_id,
         media.owner_visibility(a.org_id, a.owner_type, a.owner_id),
         media.owner_event(a.org_id, a.owner_type, a.owner_id)
  FROM media.variants v
  JOIN media.assets a ON a.org_id = v.org_id AND a.id = v.asset_id
  WHERE v.org_id = p_org AND v.asset_id = p_asset AND v.file_name = p_file
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.serve_target(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.serve_target(uuid, uuid, text) TO app_user;--> statement-breakpoint
-- The images of one event's program (speaker photos, exhibitor and sponsor logos) in one query,
-- for its public page (`p_private_ok`: the server checked the visitor's access grant).
CREATE FUNCTION media.public_program_media(p_org uuid, p_event uuid, p_private_ok boolean)
RETURNS TABLE (
  org_id uuid, asset_id uuid, owner_id uuid, owner_type text, slot text, "position" integer, width integer,
  height integer, alt text, decorative boolean, variants jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.org_id, a.id, a.owner_id, a.owner_type, a.slot, a.position, a.width, a.height, a.alt, a.decorative,
         (SELECT jsonb_agg(jsonb_build_object('format', v.format, 'width', v.width, 'height', v.height,
                                              'file_name', v.file_name, 'fallback', v.fallback))
          FROM media.variants v WHERE v.org_id = a.org_id AND v.asset_id = a.id)
  FROM media.assets a
  WHERE a.org_id = p_org
    AND ((a.owner_type = 'speaker' AND a.owner_id IN (
           SELECT s.id FROM program.speakers s WHERE s.org_id = p_org AND s.event_id = p_event))
      OR (a.owner_type = 'exhibitor' AND a.owner_id IN (
           SELECT x.id FROM program.exhibitors x WHERE x.org_id = p_org AND x.event_id = p_event))
      OR (a.owner_type = 'sponsor' AND a.owner_id IN (
           SELECT s.id FROM program.sponsors s WHERE s.org_id = p_org AND s.event_id = p_event)))
    AND media.owner_visibility(p_org, 'event', p_event) = ANY (
      CASE WHEN p_private_ok THEN ARRAY['public', 'private_event'] ELSE ARRAY['public'] END)
  ORDER BY a.owner_type, a.owner_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.public_program_media(uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.public_program_media(uuid, uuid, boolean) TO app_user;
-- hand-written: end
