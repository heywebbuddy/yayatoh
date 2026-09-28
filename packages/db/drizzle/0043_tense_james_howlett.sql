CREATE TABLE "seating"."seating_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'warn' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "seating_rules_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "seating_rules_kind_check" CHECK (kind in ('ada_reserved', 'max_per_order_seats')),
	CONSTRAINT "seating_rules_severity_check" CHECK (severity in ('warn', 'enforce')),
	CONSTRAINT "seating_rules_params_check" CHECK (jsonb_typeof(params) = 'object')
);
--> statement-breakpoint
ALTER TABLE "seating"."seating_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seating"."seating_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "seating_rules_org_id_idx" ON "seating"."seating_rules" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seating_rules_org_event_kind_key" ON "seating"."seating_rules" USING btree ("org_id","event_id","kind");--> statement-breakpoint
CREATE POLICY "seating_rules_tenant_isolation" ON "seating"."seating_rules" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- Hand-written (M1.7f live availability): after any statement that changes seats' state, price
-- or existence, wake the listeners of the events it touched (the seat feed re-reads them and
-- publishes a delta). NOTIFY is transactional: it is delivered only on commit (never for a
-- rolled-back hold), and identical notifications in one transaction are delivered once, so a
-- burst of changes wakes listeners once per event. The payload is "org:event" only, never who.
-- Runs as the caller (no SECURITY DEFINER); transition tables hold only the caller's own rows.
CREATE FUNCTION seating.event_seats_notify() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR r IN
      SELECT DISTINCT n.org_id, n.event_id
        FROM new_rows n JOIN old_rows o ON o.id = n.id
       WHERE (o.status, o.block_reason, o.ticket_type_id, o.hold_id)
             IS DISTINCT FROM (n.status, n.block_reason, n.ticket_type_id, n.hold_id)
    LOOP
      PERFORM pg_notify('seating_seats', r.org_id::text || ':' || r.event_id::text);
    END LOOP;
  ELSIF TG_OP = 'INSERT' THEN
    FOR r IN SELECT DISTINCT org_id, event_id FROM new_rows LOOP
      PERFORM pg_notify('seating_seats', r.org_id::text || ':' || r.event_id::text);
    END LOOP;
  ELSE
    FOR r IN SELECT DISTINCT org_id, event_id FROM old_rows LOOP
      PERFORM pg_notify('seating_seats', r.org_id::text || ':' || r.event_id::text);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER event_seats_notify_update AFTER UPDATE ON "seating"."event_seats"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION seating.event_seats_notify();--> statement-breakpoint
CREATE TRIGGER event_seats_notify_insert AFTER INSERT ON "seating"."event_seats"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION seating.event_seats_notify();--> statement-breakpoint
CREATE TRIGGER event_seats_notify_delete AFTER DELETE ON "seating"."event_seats"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION seating.event_seats_notify();--> statement-breakpoint
-- Hand-written: a rule change (an accessible seat kept back or released) and a plan put on sale
-- (or locked) change what buyers may choose without touching a seat, so they wake the same
-- listeners.
CREATE FUNCTION seating.event_row_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('seating_seats', COALESCE(NEW.org_id, OLD.org_id)::text || ':' || COALESCE(NEW.event_id, OLD.event_id)::text);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER seating_rules_notify AFTER INSERT OR UPDATE OR DELETE ON "seating"."seating_rules"
  FOR EACH ROW EXECUTE FUNCTION seating.event_row_notify();--> statement-breakpoint
CREATE TRIGGER event_layouts_notify AFTER UPDATE OF status ON "seating"."event_layouts"
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION seating.event_row_notify();
