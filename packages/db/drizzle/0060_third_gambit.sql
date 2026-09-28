-- M1.7g: per-date seating charts and floor plan images (expand only: new nullable columns, wider
-- CHECKs, unique indexes replaced by partial ones that keep the old rule for the event plan).
ALTER TABLE "seating"."event_layouts" ADD COLUMN "occurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" ADD COLUMN "occurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" ADD COLUMN "held_for_occurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "seating"."seat_assignments" ADD COLUMN "occurrence_id" uuid;--> statement-breakpoint
-- hand-written: begin (reordered: the new unique indexes exist before the old ones go, so the
-- event plan's uniqueness never lapses; every existing row is the event plan, occurrence_id null)
CREATE UNIQUE INDEX "event_layouts_org_event_plan_key" ON "seating"."event_layouts" USING btree ("org_id","event_id") WHERE occurrence_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_layouts_org_event_date_key" ON "seating"."event_layouts" USING btree ("org_id","event_id","occurrence_id") WHERE occurrence_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_seats_org_event_plan_seat_key" ON "seating"."event_seats" USING btree ("org_id","event_id","seat_uuid") WHERE occurrence_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_seats_org_event_date_seat_key" ON "seating"."event_seats" USING btree ("org_id","event_id","occurrence_id","seat_uuid") WHERE occurrence_id is not null;--> statement-breakpoint
CREATE INDEX "event_seats_org_held_for_idx" ON "seating"."event_seats" USING btree ("org_id","event_id","held_for_occurrence_id") WHERE held_for_occurrence_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_org_event_plan_attendee_key" ON "seating"."seat_assignments" USING btree ("org_id","event_id","attendee_id") WHERE occurrence_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_org_event_date_attendee_key" ON "seating"."seat_assignments" USING btree ("org_id","event_id","occurrence_id","attendee_id") WHERE occurrence_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_org_event_plan_seat_key" ON "seating"."seat_assignments" USING btree ("org_id","event_id","seat_uuid") WHERE occurrence_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_org_event_date_seat_key" ON "seating"."seat_assignments" USING btree ("org_id","event_id","occurrence_id","seat_uuid") WHERE occurrence_id is not null;--> statement-breakpoint
DROP INDEX "seating"."event_layouts_org_event_key";--> statement-breakpoint
DROP INDEX "seating"."event_seats_org_event_seat_key";--> statement-breakpoint
DROP INDEX "seating"."seat_assignments_org_event_attendee_key";--> statement-breakpoint
DROP INDEX "seating"."seat_assignments_org_event_seat_key";--> statement-breakpoint
-- A date's own chart belongs to one of the event's dates (seating, tier 3, references events,
-- tier 2, without importing its schema). Dates are cancelled, never deleted.
ALTER TABLE "seating"."event_layouts" ADD CONSTRAINT "event_layouts_occurrence_fk" FOREIGN KEY ("org_id","occurrence_id") REFERENCES "events"."occurrences"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" VALIDATE CONSTRAINT "event_layouts_occurrence_fk";--> statement-breakpoint
-- Backfill (existing rows only; the migrator bypasses RLS): the date each held or sold seat of the
-- event plan is for — a sold seat's ticket date, a held seat's order date. Seats sold with no date
-- stay unknown, which keeps every date from getting its own chart while they are sold.
UPDATE "seating"."event_seats" s SET held_for_occurrence_id = t.occurrence_id
  FROM "ticketing"."tickets" t
  WHERE s.status = 'sold' AND t.org_id = s.org_id AND t.id = s.ticket_id AND t.occurrence_id IS NOT NULL;--> statement-breakpoint
UPDATE "seating"."event_seats" s SET held_for_occurrence_id = o.occurrence_id
  FROM "orders"."orders" o
  WHERE s.status = 'held' AND o.org_id = s.org_id AND o.id = s.hold_id AND o.occurrence_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" ADD CONSTRAINT "event_seats_held_for_check" CHECK (held_for_occurrence_id is null or (occurrence_id is null and status in ('held', 'sold'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" VALIDATE CONSTRAINT "event_seats_held_for_check";--> statement-breakpoint
-- Media: an event's floor plan images (slot 'floorplan').
ALTER TABLE "media"."assets" DROP CONSTRAINT "assets_slot_check";--> statement-breakpoint
ALTER TABLE "media"."assets" DROP CONSTRAINT "assets_owner_slot_check";--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_slot_check" CHECK (slot in ('cover', 'gallery', 'photo', 'logo', 'floorplan')) NOT VALID;--> statement-breakpoint
ALTER TABLE "media"."assets" VALIDATE CONSTRAINT "assets_slot_check";--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_owner_slot_check" CHECK ((owner_type = 'event' and slot in ('cover', 'gallery', 'floorplan')) or (owner_type = 'venue' and slot = 'photo') or (owner_type = 'org' and slot = 'logo' and owner_id = org_id)) NOT VALID;--> statement-breakpoint
ALTER TABLE "media"."assets" VALIDATE CONSTRAINT "assets_owner_slot_check";--> statement-breakpoint
-- What /media/{org}/{asset}/{file} points at, now with the slot (a floor plan image is public only
-- where the organizer shows it; the server checks). serve_target (v1) stays until the contract step.
CREATE FUNCTION media.serve_target_v2(p_org uuid, p_asset uuid, p_file text)
RETURNS TABLE (format text, bytes integer, sha256 text, owner_type text, owner_id uuid, visibility text, slot text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.format, v.bytes, v.sha256, a.owner_type, a.owner_id,
         media.owner_visibility(a.org_id, a.owner_type, a.owner_id), a.slot
  FROM media.variants v
  JOIN media.assets a ON a.org_id = v.org_id AND a.id = v.asset_id
  WHERE v.org_id = p_org AND v.asset_id = p_asset AND v.file_name = p_file
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.serve_target_v2(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.serve_target_v2(uuid, uuid, text) TO app_user;--> statement-breakpoint
-- A guest's seat is freed on the chart it is on (seat ids repeat on a date's copy of the plan).
CREATE OR REPLACE FUNCTION seating.seat_assignment_released() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE seating.event_seats
     SET status = CASE WHEN OLD.prior_block IS NULL THEN 'available' ELSE 'blocked' END,
         block_reason = OLD.prior_block,
         updated_at = now()
   WHERE org_id = OLD.org_id
     AND event_id = OLD.event_id
     AND occurrence_id IS NOT DISTINCT FROM OLD.occurrence_id
     AND seat_uuid = OLD.seat_uuid
     AND status = 'blocked'
     AND block_reason = 'assigned';
  RETURN OLD;
END;
$$;
-- hand-written: end
