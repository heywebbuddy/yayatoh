-- hand-written: begin (QA #25: self-serve orgs in setup mode (`limited`) can sell. A `limited` org is
-- operating (tenancy.isOperatingStatus): only bulk messaging waits for onboarding. These public lookups
-- still required `active`, so checkout on a limited org's event answered "We could not find that", and
-- its buyers' tickets, venue quotes and display links were missing too. Each function is re-created as
-- it is live, with only the org status rule widened; grants are kept by CREATE OR REPLACE.)
CREATE OR REPLACE FUNCTION command_center.display_link_target(p_token_hash text)
 RETURNS TABLE(org_id uuid, event_id uuid, link_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT l.org_id, l.event_id, l.id FROM command_center.display_links l
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE l.token_hash = p_token_hash AND l.revoked_at IS NULL
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION events.checkout_target(p_slug text)
 RETURNS TABLE(org_id uuid, event_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT e.org_id, e.id FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  WHERE e.slug = lower(p_slug) AND e.status = 'published' AND e.visibility IN ('public', 'unlisted')
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION events.public_event_target(p_org uuid, p_event uuid)
 RETURNS TABLE(org_id uuid, event_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT e.org_id, e.id FROM events.events e
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  WHERE e.org_id = p_org AND e.id = p_event
    AND e.status = 'published' AND e.visibility IN ('public', 'unlisted')
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION orders.order_refs_by_email(p_email text)
 RETURNS TABLE(org_id uuid, order_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT o.org_id, o.id FROM orders.orders o
  JOIN tenancy.organizations g ON g.id = o.org_id AND g.status IN ('active', 'limited')
  WHERE o.buyer_email = lower(p_email) AND o.status IN ('paid', 'partially_refunded', 'refunded')
  ORDER BY o.created_at DESC
  LIMIT 200
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notifications.app_orgs_by_email(p_email text)
 RETURNS TABLE(org_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT u.org_id FROM (
    SELECT o.org_id FROM orders.orders o
    WHERE o.buyer_email = lower(btrim(p_email)) AND o.status IN ('paid', 'partially_refunded', 'refunded')
    UNION
    SELECT t.org_id FROM ticketing.tickets t
    WHERE lower(t.holder_email) = lower(btrim(p_email)) AND t.status = 'active'
  ) u
  JOIN tenancy.organizations g ON g.id = u.org_id AND g.status IN ('active', 'limited')
  LIMIT 500
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION venues.quote_target(p_slug text)
 RETURNS TABLE(org_id uuid, venue_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT v.org_id, v.id FROM venues.venues v
  JOIN tenancy.organizations o ON o.id = v.org_id AND o.status IN ('active', 'limited')
  WHERE v.slug = lower(p_slug) AND v.directory_listed AND v.archived_at IS NULL
$function$;
-- hand-written: end
