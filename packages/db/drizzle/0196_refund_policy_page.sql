-- hand-written: begin (Refund policy site page, editable in admin "Site content" → Pages; inserted only when missing, so it is safe on live and never overwrites an edit)
INSERT INTO cms.platform_pages (slug, locale, title, body, effective_date, status, version, published_at, updated_by)
SELECT 'refund-policy', 'en', $yy$Refund policy$yy$, $yy$> DRAFT for legal review: not yet the final text.

This policy explains when you can get your money back for a ticket bought through Yayatoh. Yayatoh is the platform; the organizer of each event is the seller of its tickets, so the organizer sets the refund rules for their event.

## Where to find the rules for your event

The refund rules for an event are shown on its page and again at checkout, and they are repeated in your confirmation email. If an event does not state its own rules, the standard terms below apply.

## Standard terms

- **Cancelled events:** if the organizer cancels an event, every ticket is refunded in full, including fees, to the original payment method.
- **Postponed or rescheduled events:** your ticket stays valid for the new date. If you cannot attend the new date you may request a refund within 14 days of the announcement.
- **Changes you make:** unless the organizer's rules say otherwise, tickets are not refundable once bought. Many organizers allow refunds up to a set time before the event, and you can often transfer your ticket to someone else instead.
- **Significant changes:** if the venue, the lineup or the format changes in a way that matters, you may request a refund within 14 days of the change.

## How to request a refund

Open your order from the link in your confirmation email, or from **My tickets**, and choose **Request a refund**. The request goes to the organizer, who reviews it and replies, usually within five working days. Tell us if you have not heard back and we will follow up with the organizer.

## How refunds are paid

Approved refunds go back to the card or wallet you paid with. Your bank normally shows the money within 5 to 10 business days. You are never asked to pay anything extra to receive a refund.

## Service fees

Fees are refunded when the event is cancelled or when we made a mistake. For other refunds, the organizer chooses whether to return the service fee, and the order page shows exactly what will be returned before you confirm.

## Free tickets and donations

Free tickets have nothing to refund and can be cancelled from your order. Donations are final unless the organizer decides otherwise or the payment was made in error.

## Disputes

If you think you were charged by mistake, contact us first through the [contact page](/contact). Please do this before asking your bank for a chargeback, so we can fix it faster.

## Contact

Questions about a refund can be sent through the [contact page](/contact). The [terms of service](/terms) and [privacy notice](/privacy) also apply.$yy$, '2026-11-01', 'published', 1, now(), 'staff:migration'
WHERE NOT EXISTS (SELECT 1 FROM cms.platform_pages WHERE slug = 'refund-policy' AND locale = 'en');--> statement-breakpoint
INSERT INTO cms.platform_page_versions (page_id, version, title, body, effective_date, status, saved_by)
SELECT p.id, 1, p.title, p.body, p.effective_date, p.status, 'staff:migration' FROM cms.platform_pages p
WHERE p.slug = 'refund-policy' AND p.locale = 'en' AND NOT EXISTS (SELECT 1 FROM cms.platform_page_versions v WHERE v.page_id = p.id);
-- hand-written: end
