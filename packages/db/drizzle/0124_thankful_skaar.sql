-- hand-written: begin
-- M4.4a: the seat finder's `pin` mode. Widened check (add v2 NOT VALID → validate → drop → rename),
-- so the table is never without one. migrate.ts sets lock_timeout.
ALTER TABLE "seating"."event_layouts" ADD CONSTRAINT "event_layouts_finder_mode_check_v2" CHECK (finder_mode in ('code', 'name', 'pin')) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" VALIDATE CONSTRAINT "event_layouts_finder_mode_check_v2";--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" DROP CONSTRAINT "event_layouts_finder_mode_check";--> statement-breakpoint
ALTER TABLE "seating"."event_layouts" RENAME CONSTRAINT "event_layouts_finder_mode_check_v2" TO "event_layouts_finder_mode_check";
-- hand-written: end
