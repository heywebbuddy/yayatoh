CREATE TABLE "cms"."platform_contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"last_reply" text,
	"replied_at" timestamp with time zone,
	"replied_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "platform_contact_messages_name_check" CHECK (char_length(name) between 1 and 120),
	CONSTRAINT "platform_contact_messages_email_check" CHECK (email = lower(email) and email like '%@%' and char_length(email) <= 254),
	CONSTRAINT "platform_contact_messages_subject_check" CHECK (char_length(subject) between 1 and 160),
	CONSTRAINT "platform_contact_messages_message_check" CHECK (char_length(message) between 1 and 4000),
	CONSTRAINT "platform_contact_messages_status_check" CHECK (status in ('new', 'replied', 'closed')),
	CONSTRAINT "platform_contact_messages_notes_check" CHECK (char_length(notes) <= 4000)
);
--> statement-breakpoint
CREATE TABLE "cms"."platform_page_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"effective_date" date NOT NULL,
	"status" text NOT NULL,
	"saved_by" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms"."platform_pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"effective_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "platform_pages_slug_check" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' and char_length(slug) <= 60),
	CONSTRAINT "platform_pages_title_check" CHECK (char_length(title) between 1 and 160),
	CONSTRAINT "platform_pages_body_check" CHECK (char_length(body) <= 120000),
	CONSTRAINT "platform_pages_status_check" CHECK (status in ('draft', 'published')),
	CONSTRAINT "platform_pages_published_check" CHECK ((status = 'published') = (published_at is not null))
);
--> statement-breakpoint
CREATE TABLE "cms"."platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "platform_settings_key_check" CHECK (key in ('contact', 'about'))
);
--> statement-breakpoint
ALTER TABLE "cms"."platform_page_versions" ADD CONSTRAINT "platform_page_versions_page_id_platform_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "cms"."platform_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_contact_messages_status_idx" ON "cms"."platform_contact_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_page_versions_key" ON "cms"."platform_page_versions" USING btree ("page_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_pages_slug_key" ON "cms"."platform_pages" USING btree ("slug");
--> statement-breakpoint
-- hand-written: begin (site pages, settings and the contact inbox: staff write through the cms.* functions,
-- the public reads published pages and settings through views, and the Contact form writes through cms.contact_submit)
REVOKE ALL ON cms.platform_settings, cms.platform_pages, cms.platform_page_versions, cms.platform_contact_messages FROM app_user;--> statement-breakpoint
GRANT SELECT ON cms.platform_settings, cms.platform_pages, cms.platform_page_versions, cms.platform_contact_messages TO platform_reader;--> statement-breakpoint
CREATE VIEW cms.public_platform_settings AS SELECT key, value, updated_at FROM cms.platform_settings;--> statement-breakpoint
CREATE VIEW cms.public_platform_pages AS
  SELECT slug, title, body, effective_date, version, published_at, updated_at FROM cms.platform_pages WHERE status = 'published';--> statement-breakpoint
GRANT SELECT ON cms.public_platform_settings, cms.public_platform_pages TO app_user;--> statement-breakpoint
CREATE FUNCTION cms.platform_save_setting(p_key text, p_value jsonb, p_actor text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_save_setting: a staff actor is required'; END IF;
  INSERT INTO cms.platform_settings (key, value, updated_by) VALUES (p_key, p_value, p_actor)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now(), updated_by = p_actor;
  RETURN true;
END $$;--> statement-breakpoint
CREATE FUNCTION cms.platform_save_page(p jsonb, p_actor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid; v_ver int; v_status text := coalesce(p->>'status', 'draft'); v_pub timestamptz;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'platform_save_page: a staff actor is required'; END IF;
  SELECT id, version, published_at INTO v_id, v_ver, v_pub FROM cms.platform_pages WHERE slug = p->>'slug' FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO cms.platform_pages (slug, title, body, effective_date, status, version, published_at, updated_by)
    VALUES (p->>'slug', p->>'title', coalesce(p->>'body', ''), (p->>'effectiveDate')::date, v_status, 1,
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
END $$;--> statement-breakpoint
CREATE FUNCTION cms.contact_submit(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO cms.platform_contact_messages (name, email, subject, message, locale)
  VALUES (btrim(p->>'name'), lower(btrim(p->>'email')), btrim(p->>'subject'), btrim(p->>'message'), coalesce(nullif(p->>'locale', ''), 'en'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;--> statement-breakpoint
CREATE FUNCTION cms.contact_update(p_id uuid, p_status text, p_notes text, p_actor text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'contact_update: a staff actor is required'; END IF;
  IF p_status NOT IN ('new', 'replied', 'closed') THEN RAISE EXCEPTION 'contact_update: unknown status'; END IF;
  UPDATE cms.platform_contact_messages SET status = p_status, notes = p_notes, updated_at = now(), updated_by = p_actor WHERE id = p_id;
  RETURN FOUND;
END $$;--> statement-breakpoint
CREATE FUNCTION cms.contact_replied(p_id uuid, p_reply text, p_actor text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'contact_replied: a staff actor is required'; END IF;
  UPDATE cms.platform_contact_messages SET status = 'replied', last_reply = p_reply, replied_at = now(), replied_by = p_actor,
    updated_at = now(), updated_by = p_actor WHERE id = p_id;
  RETURN FOUND;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION cms.platform_save_setting(text, jsonb, text), cms.platform_save_page(jsonb, text), cms.contact_submit(jsonb),
  cms.contact_update(uuid, text, text, text), cms.contact_replied(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION cms.platform_save_setting(text, jsonb, text), cms.platform_save_page(jsonb, text),
  cms.contact_update(uuid, text, text, text), cms.contact_replied(uuid, text, text) TO platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION cms.contact_submit(jsonb) TO app_user;--> statement-breakpoint
INSERT INTO cms.platform_pages (slug, title, body, effective_date, status, version, published_at, updated_by)
VALUES ('privacy', $yy$Privacy notice$yy$, $yy$> DRAFT for legal review — not yet the final text.

This notice explains how Yayatoh handles personal data when you use the platform to run events, or to buy tickets and attend them.

## Who is responsible

The organizer of an event decides how attendee data is used and is its controller; Yayatoh processes that data on the organizer’s behalf under a data processing agreement. Yayatoh is the controller for organizer and staff accounts, the public event marketplace and fraud prevention.

## What we collect

Account details (name, email, password or sign-in codes); buyer and attendee details given at checkout (name, email, answers to the organizer’s questions); tickets, orders and check-ins; and technical data such as device and request logs. Card details are handled by Stripe and never reach Yayatoh.

## Why we use it

To sell and deliver tickets, run check-in, send the messages you asked for, pay organizers, prevent fraud and abuse, keep the service secure, and meet legal duties. Marketing messages are only sent with your consent, and Global Privacy Control signals are honored.

## Who we share it with

With the organizer of the event you book, with the sub-processors on our sub-processor list, and with authorities when the law requires it. We do not sell personal data.

## How long we keep it

Attendee details are removed 24 months after the event and check-in logs after 12 months. Payment records are kept for 7 years for tax and accounting. Checkouts that were never paid lose their personal details after 30 days.

## How we protect it

Each organizer’s data is kept apart from every other organizer’s; sensitive answers and keys are encrypted; access by Yayatoh staff is limited and logged.

## Your rights

You can ask for a copy of your data, to correct it, or to have it erased. For an event, ask its organizer, who can export or erase your data from their Yayatoh console; you can also write to us and we will pass the request on. Data the law requires us to keep (such as paid orders) is kept without details that identify you.

## Contact

Pani Digital Services, LLC operates Yayatoh. Contact details for privacy requests will be published here with the final text.

[See the list of sub-processors](/sub-processors)$yy$, '2026-09-27', 'published', 1, now(), 'staff:migration');--> statement-breakpoint
INSERT INTO cms.platform_page_versions (page_id, version, title, body, effective_date, status, saved_by)
SELECT id, 1, title, body, effective_date, status, 'staff:migration' FROM cms.platform_pages WHERE slug = 'privacy';--> statement-breakpoint
INSERT INTO cms.platform_pages (slug, title, body, effective_date, status, version, published_at, updated_by)
VALUES ('terms', $yy$Terms of service$yy$, $yy$> DRAFT for legal review: not yet the final text.

These terms apply when you use Yayatoh to run events, to buy tickets or to attend events. By creating an account, buying a ticket or using the platform you agree to them.

## Who we are

Yayatoh is operated by Pani Digital Services, LLC. In these terms "we" and "Yayatoh" mean that company.

## Accounts

Keep your sign-in details safe and give us accurate information. You are responsible for what happens under your account. Tell us at once if you think someone else has access to it.

## Organizers

An organizer creates events, sets ticket prices and decides who may attend. The organizer is the seller of the tickets and is responsible for the event, its content, refunds and any permits or taxes the event needs. Yayatoh provides the platform and collects payments for the organizer.

## Attendees

When you buy a ticket you enter a contract with the organizer. Refund and transfer rules are shown at checkout and in your confirmation email. Tickets may be checked at the door, and a ticket that was shared or copied can be refused.

## Payments and fees

Card payments are handled by our payment provider. Fees are shown before you pay. Organizers are paid out according to the payout schedule in their account.

## Acceptable use

Do not use Yayatoh to break the law, to sell anything unlawful, to send spam, to harass others, to attack or overload the service, or to collect other people's data without a legal basis. We may remove content or suspend accounts that break these rules.

## Your content

You keep the rights to what you upload. You allow us to host and display it so the service works, for example on event pages and in emails.

## Availability and liability

We work to keep the service running but cannot promise it will never be interrupted. To the extent the law allows, we are not liable for indirect losses, and our total liability is limited to the fees we received for the transaction in question.

## Changes

We may update these terms. When a change matters we will tell organizers before it starts. The date at the top of this page shows when it last changed.

## Contact

Questions about these terms can be sent through the [contact page](/contact).$yy$, '2026-09-27', 'published', 1, now(), 'staff:migration');--> statement-breakpoint
INSERT INTO cms.platform_page_versions (page_id, version, title, body, effective_date, status, saved_by)
SELECT id, 1, title, body, effective_date, status, 'staff:migration' FROM cms.platform_pages WHERE slug = 'terms';--> statement-breakpoint
INSERT INTO cms.platform_pages (slug, title, body, effective_date, status, version, published_at, updated_by)
VALUES ('cookies', $yy$Cookie policy$yy$, $yy$> DRAFT for legal review: not yet the final text.

This page explains the cookies and similar technologies Yayatoh uses.

## What a cookie is

A cookie is a small text file a website stores in your browser. Some are needed for the site to work; others help us understand how it is used.

## Cookies we always use

- **Sign-in and session:** keep you signed in and protect your account.
- **Security:** help prevent fraud, abuse and automated attacks, and protect forms.
- **Preferences:** remember your language and the light or dark theme you chose.
- **Checkout:** remember your cart while you buy a ticket.

## Cookies that need your consent

Analytics and marketing cookies are only set after you agree. You can change your choice at any time in your cookie preferences. We honor the Global Privacy Control signal.

## Third parties

Some features use services run by other companies, for example payments and embedded videos. They may set their own cookies. Our [sub-processor list](/sub-processors) names the companies that process data for us.

## Managing cookies

You can delete or block cookies in your browser settings. Blocking the cookies listed above as always used may stop sign-in or checkout from working.

## Contact

Questions about cookies can be sent through the [contact page](/contact).$yy$, '2026-09-27', 'published', 1, now(), 'staff:migration');--> statement-breakpoint
INSERT INTO cms.platform_page_versions (page_id, version, title, body, effective_date, status, saved_by)
SELECT id, 1, title, body, effective_date, status, 'staff:migration' FROM cms.platform_pages WHERE slug = 'cookies';--> statement-breakpoint
INSERT INTO cms.platform_pages (slug, title, body, effective_date, status, version, published_at, updated_by)
VALUES ('sub-processors', $yy$Sub-processors$yy$, $yy$> DRAFT for legal review: the list follows the planned hosting and may change before launch.

These companies process personal data on Yayatoh’s behalf to run the service.

## Vercel Inc.

- What they do: Web hosting and delivery
- Data: Request and technical data
- Location: United States

## Neon Inc.

- What they do: Database hosting
- Data: All account and event data
- Location: United States

## Fly.io Inc.

- What they do: Background jobs
- Data: All account and event data
- Location: United States

## Upstash Inc.

- What they do: Rate limiting and caching
- Data: Request and technical data
- Location: United States

## Cloudflare Inc.

- What they do: File storage and content delivery
- Data: Exported files and images
- Location: United States / global edge

## Amazon Web Services Inc.

- What they do: Email delivery and key management
- Data: Names, email addresses and phone numbers
- Location: United States

## Stripe Inc.

- What they do: Payments and payouts
- Data: Payment details and payout accounts
- Location: United States

## Twilio Inc.

- What they do: Text messages
- Data: Names, email addresses and phone numbers
- Location: United States

## Ably Realtime Ltd.

- What they do: Live updates
- Data: Request and technical data
- Location: European Union / United States

## Functional Software Inc. (Sentry)

- What they do: Error monitoring
- Data: Request and technical data
- Location: United States

## Axiom Inc.

- What they do: Logs
- Data: Request and technical data
- Location: United States

We give organizers 30 days’ notice before adding or replacing a sub-processor.

[Read the privacy notice](/privacy)$yy$, '2026-09-27', 'published', 1, now(), 'staff:migration');--> statement-breakpoint
INSERT INTO cms.platform_page_versions (page_id, version, title, body, effective_date, status, saved_by)
SELECT id, 1, title, body, effective_date, status, 'staff:migration' FROM cms.platform_pages WHERE slug = 'sub-processors';--> statement-breakpoint
INSERT INTO cms.platform_settings (key, value, updated_by) VALUES ('contact', $yy${"address": "Pani Digital Services, LLC\nYayatoh support\nUnited States", "phone": "", "email": "support@yayatoh.com", "supportEmail": "support@yayatoh.com", "hours": "Monday to Friday, 9:00 to 17:00 (US Eastern Time)"}$yy$::jsonb, 'staff:migration'), ('about', $yy${"lede": "Yayatoh helps people put on events and helps everyone else find them, from a first meetup to a multi-day festival.", "mission": "Make it simple for anyone to run a great event and for every guest to feel welcome from the first email to the last goodbye.", "story": "Yayatoh started with organizers who were tired of juggling one tool for tickets, another for check-in and a third for sponsors.\n\nWe built one place for all of it: beautiful event pages, fast checkout, reliable check-in at the door, and the tools that make a community want to come back.", "values": [{"title": "Guests first", "text": "Every screen is designed so the person arriving at your event feels looked after."}, {"title": "Honest and clear", "text": "Simple pricing, plain language and no surprises at checkout."}, {"title": "Reliable on the day", "text": "Tickets that scan, lines that move and support that answers."}, {"title": "Open to everyone", "text": "Accessible, available in many languages and built for events of every size."}], "attendees": "Find events near you, buy tickets in a few taps, keep them in your wallet and meet other guests before the doors open.", "organizers": "Sell tickets, manage sponsors, speakers and exhibitors, check guests in and see how your event is doing, all in one place.", "team": [{"name": "Ratnesh Kumar", "role": "Founder", "bio": "Builds the platform and listens to every organizer."}, {"name": "Support team", "role": "Customer care", "bio": "Answers organizers and attendees, usually within one working day."}], "stats": [{"value": "13", "label": "languages"}, {"value": "24/7", "label": "ticket access"}, {"value": "1", "label": "place for everything"}], "ctaTitle": "Ready to run your next event?", "ctaLabel": "Become an organizer", "ctaHref": "/for-organizers"}$yy$::jsonb, 'staff:migration');
-- hand-written: end
