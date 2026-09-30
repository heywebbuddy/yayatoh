CREATE TABLE "seating"."seat_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"attendee_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"seat_uuid" uuid NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"prior_block" text,
	CONSTRAINT "seat_assignments_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "seat_assignments_prior_block_check" CHECK (prior_block is null or prior_block in ('channel', 'ada'))
);
--> statement-breakpoint
ALTER TABLE "seating"."seat_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."seat_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Existing table: widen the block reasons (a guest's seat is blocked 'assigned'). NOT VALID +
-- VALIDATE keeps the lock short (expand/contract); every existing row already satisfies it.
ALTER TABLE "seating"."event_seats" DROP CONSTRAINT "event_seats_block_check";--> statement-breakpoint
ALTER TABLE "seating"."event_seats" ADD CONSTRAINT "event_seats_block_check" CHECK ((status = 'blocked') = (block_reason is not null) and (block_reason is null or block_reason in ('channel', 'ada', 'kill', 'assigned'))) NOT VALID;--> statement-breakpoint
ALTER TABLE "seating"."event_seats" VALIDATE CONSTRAINT "event_seats_block_check";--> statement-breakpoint
CREATE INDEX "seat_assignments_org_id_idx" ON "seating"."seat_assignments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_org_event_attendee_key" ON "seating"."seat_assignments" USING btree ("org_id","event_id","attendee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_org_event_seat_key" ON "seating"."seat_assignments" USING btree ("org_id","event_id","seat_uuid");--> statement-breakpoint
CREATE INDEX "seat_assignments_org_event_item_idx" ON "seating"."seat_assignments" USING btree ("org_id","event_id","item_id");--> statement-breakpoint
CREATE INDEX "seat_assignments_org_attendee_idx" ON "seating"."seat_assignments" USING btree ("org_id","attendee_id");--> statement-breakpoint
CREATE POLICY "seat_assignments_tenant_isolation" ON "seating"."seat_assignments" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- Hand-written: seating (tier 3) references attendees (tier 2) without importing its schema.
ALTER TABLE "seating"."seat_assignments" ADD CONSTRAINT "seat_assignments_attendee_fk" FOREIGN KEY ("org_id","attendee_id") REFERENCES "attendees"."attendees"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- Hand-written: however an assignment goes (unseated, refunded, the attendee record deleted by an
-- import undo, the seat removed from the plan), its seat gets back what it had before: free, or
-- the channel/accessibility block it carried. Runs as the caller, under the same RLS.
CREATE FUNCTION seating.seat_assignment_released() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE seating.event_seats
     SET status = CASE WHEN OLD.prior_block IS NULL THEN 'available' ELSE 'blocked' END,
         block_reason = OLD.prior_block,
         updated_at = now()
   WHERE org_id = OLD.org_id
     AND event_id = OLD.event_id
     AND seat_uuid = OLD.seat_uuid
     AND status = 'blocked'
     AND block_reason = 'assigned';
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER seat_assignment_released AFTER DELETE ON "seating"."seat_assignments"
  FOR EACH ROW EXECUTE FUNCTION seating.seat_assignment_released();
