/**
 * Starter content for the platform CMS (M3.11b): help center categories and articles, and the
 * marketing site's sections. Written from the features that exist today; **draft copy for the
 * owner to review** (docs/owner-inbox.md, M3.11b) before launch. The seed loads it into the
 * marketplace content org (`MARKETPLACE_CONTENT_ORG`, Harbor Arts locally). One article and one
 * section stay drafts so the "unpublished content is hidden" checks have something to hide.
 */

export interface StarterCategory {
  readonly slug: string;
  readonly audience: 'organizers' | 'buyers';
  readonly title: string;
  readonly description: string;
  readonly position: number;
  readonly translations?: Readonly<Record<string, { title: string; description: string | null }>>;
}

export interface StarterArticle {
  readonly category: string;
  readonly locale?: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly keywords: string;
  readonly position: number;
  readonly body: string;
  readonly draft?: boolean;
}

export interface StarterSection {
  readonly placement: 'home' | 'features' | 'contact';
  readonly locale?: string;
  readonly slug: string;
  readonly position: number;
  readonly eyebrow?: string;
  readonly heading: string;
  readonly body: string;
  readonly cta?: { label: string; href: string };
  readonly draft?: boolean;
}

export const STARTER_CATEGORIES: readonly StarterCategory[] = [
  {
    slug: 'getting-started',
    audience: 'organizers',
    title: 'Getting started',
    description: 'Create your organization, your first event and your public page.',
    position: 10,
    translations: { ar: { title: 'البدء', description: 'أنشئ مؤسستك وفعاليتك الأولى وصفحتك العامة.' } },
  },
  {
    slug: 'selling-tickets',
    audience: 'organizers',
    title: 'Selling tickets',
    description: 'Ticket types, prices, promo codes and checkout.',
    position: 20,
    translations: {
      ar: { title: 'بيع التذاكر', description: 'أنواع التذاكر والأسعار وأكواد الخصم والدفع.' },
    },
  },
  {
    slug: 'seating',
    audience: 'organizers',
    title: 'Seating',
    description: 'Seating charts, reserved seats and table assignments.',
    position: 30,
    translations: {
      ar: { title: 'المقاعد', description: 'مخططات المقاعد والمقاعد المحجوزة وتوزيع الطاولات.' },
    },
  },
  {
    slug: 'check-in',
    audience: 'organizers',
    title: 'Check-in',
    description: 'Scanning tickets at the door, door staff and offline mode.',
    position: 40,
    translations: {
      ar: { title: 'تسجيل الدخول', description: 'مسح التذاكر عند الباب وفريق الباب والوضع دون اتصال.' },
    },
  },
  {
    slug: 'refunds-and-payouts',
    audience: 'organizers',
    title: 'Refunds and payouts',
    description: 'Refunding orders, refund policies and getting paid.',
    position: 50,
    translations: {
      ar: { title: 'الاسترداد والمدفوعات', description: 'استرداد الطلبات وسياسات الاسترداد واستلام أموالك.' },
    },
  },
  {
    slug: 'messaging',
    audience: 'organizers',
    title: 'Messaging',
    description: 'Announcements and emails to your attendees.',
    position: 60,
    translations: {
      ar: { title: 'المراسلة', description: 'الإعلانات ورسائل البريد الإلكتروني إلى الحضور.' },
    },
  },
  {
    slug: 'your-tickets',
    audience: 'buyers',
    title: 'Your tickets',
    description: 'Finding, showing and passing on your tickets.',
    position: 10,
    translations: { ar: { title: 'تذاكرك', description: 'العثور على تذاكرك وعرضها ونقلها لشخص آخر.' } },
  },
  {
    slug: 'refunds-and-changes',
    audience: 'buyers',
    title: 'Refunds and changes',
    description: 'Refunds, cancelled and postponed events.',
    position: 20,
    translations: {
      ar: { title: 'الاسترداد والتغييرات', description: 'الاسترداد والفعاليات الملغاة والمؤجلة.' },
    },
  },
];

export const STARTER_ARTICLES: readonly StarterArticle[] = [
  {
    category: 'getting-started',
    slug: 'create-your-first-event',
    title: 'Create your first event',
    summary: 'Set up an event with its date, place and details, then publish it when it is ready.',
    keywords: 'new event, create, wizard, draft, publish',
    position: 10,
    body: `In the console, open **Events** and choose **New event**. The wizard asks for the essentials:

1. **Name and type** of the event (a concert, a gala, a conference…). The type decides which pages you see in the event's menu.
2. **Date and time**, in the event's own time zone. Attendees always see times in that time zone.
3. **Where**: a venue from your venue list, a new address, or an online event.

Your event starts as a **draft**: only your team can see it. Add ticket types, a description and images, then check the **Setup guide** on the event's home page. It lists anything still missing.

When everything is ready, choose **Publish**. The event page goes live and, if your organization is listed on the marketplace, the event appears there too.

## Tips

- Use **Duplicate & template** to start a new event from an earlier one.
- A **series** groups recurring dates (for example a weekly class) under one page.`,
  },
  {
    category: 'getting-started',
    slug: 'your-public-event-page',
    title: 'Your public event page',
    summary: 'What attendees see, how to share it and how to use your own domain.',
    keywords: 'event page, share, link, domain, website, marketplace',
    position: 20,
    body: `Every published event has a public page with its date, place, description, tickets and, when you add them, the program, speakers and sponsors.

- **Share it** with the page address or a short link from the event's **Marketing** page.
- **Your own site:** under **Domains** you can connect a subdomain or your own domain. Your events and pages are then served there with your branding.
- **Embed tickets** on another website with the ticket widget (allowed origins are set in **Public site**).

Unlisted events have a page but are not shown on the marketplace or in search engines.`,
  },
  {
    category: 'selling-tickets',
    slug: 'sell-tickets',
    title: 'Sell tickets: types, prices and quantities',
    summary: 'Create ticket types with a price and a quantity, and choose when they are on sale.',
    keywords: 'ticket types, price, quantity, sales, free tickets, checkout',
    position: 10,
    body: `Open the event and go to **Tickets & Orders**. Each **ticket type** has:

- a **name** (General admission, VIP…) and an optional description;
- a **price** in the event's currency (use 0 for free tickets);
- a **quantity**: how many can be sold in total;
- optional **sale dates**, so a type goes on sale or stops selling at a set time.

Buyers pay at checkout with every fee included in the price they see. After payment they get an email with their tickets and a link to manage their order.

## Promo codes and access codes

- A **promo code** gives a discount on some or all ticket types.
- An **access code** unlocks hidden ticket types (for example for members or sponsors).`,
  },
  {
    category: 'seating',
    slug: 'reserved-seating',
    title: 'Sell reserved seats with a seating chart',
    summary: 'Draw a seating chart, link seats to ticket types and let buyers pick their seats.',
    keywords: 'seating chart, seat map, reserved seats, tables, sections, floor plan',
    position: 10,
    body: `Open the event's **Seating** page to build a chart with rows, sections and round tables. Every seat belongs to a **category**, and each category is linked to a ticket type and its price.

Once you **publish the layout**, buyers choose their seats on the event page. Seats are held while they check out and become theirs when they pay.

You can also **assign seats** yourself (for example for guests or table plans) and print a seat poster for the door. Every drag action on the chart has a keyboard and list alternative.`,
  },
  {
    category: 'check-in',
    slug: 'check-in-with-the-scan-app',
    title: 'Check guests in with the Scan app',
    summary: 'Scan tickets at the door with a phone or tablet, even without an internet connection.',
    keywords: 'check-in, scan, QR code, door, offline, devices, door staff',
    position: 10,
    body: `Open **Scan** on a phone or tablet and enroll the device for your event (from the event's **On-site** page). Door staff don't need a full console account.

- Point the camera at the ticket's QR code: a green screen means the ticket is valid and checked in; red explains why not (already used, wrong event, refunded…).
- **Offline mode:** the app keeps a copy of the guest list, so scanning continues if the Wi-Fi drops. Scans sync when the connection is back.
- Look people up **by name** when they can't show their ticket.

The event's check-in counts update live for your team.`,
  },
  {
    category: 'refunds-and-payouts',
    slug: 'refund-an-order',
    title: 'Refund an order',
    summary: 'Refund a whole order or some tickets, and set your refund policy.',
    keywords: 'refund, cancel order, money back, refund policy, partial refund',
    position: 10,
    body: `Find the order under **Tickets & Orders** and choose **Refund**. You can refund the whole order or only some tickets. Refunded tickets stop working at the door straight away, and the buyer gets an email.

Your **refund policy** is shown at checkout. When you change it, the new policy applies to orders placed afterwards; earlier orders keep the policy their buyers agreed to.

If you cancel an event, you can refund every order in one go from the cancellation steps.`,
  },
  {
    category: 'refunds-and-payouts',
    slug: 'get-paid',
    title: 'Get paid: payouts',
    summary: 'Connect your bank account and see when ticket money is paid out.',
    keywords: 'payouts, bank account, get paid, fees, finance',
    position: 20,
    body: `Open **Payouts** and connect your account with our payment provider. You'll be asked for your organization's details and a bank account; those details are held by the payment provider.

**Finance** shows what you sold, the fees and what is on its way to you. Payout timing depends on your account and your events.`,
  },
  {
    category: 'messaging',
    slug: 'email-your-attendees',
    title: 'Email your attendees',
    summary: 'Send announcements and updates to ticket holders and guests.',
    keywords: 'email, message, announcement, attendees, reminders, update',
    position: 10,
    body: `From the event's **Communications** page you can post an **announcement** on the event page and email it to ticket holders at the same time.

Attendees can reply to your messages; replies arrive in **Messages**. Marketing emails go only to people who agreed to receive them, and every email has an unsubscribe link.`,
  },
  {
    category: 'your-tickets',
    slug: 'find-your-tickets',
    title: 'Find your tickets',
    summary: 'Your tickets are in your confirmation email and under “My tickets”.',
    keywords: 'my tickets, lost tickets, confirmation email, QR code, resend',
    position: 10,
    body: `After you buy, you get an email with your tickets and a link to your order. Keep it: the link lets you see and manage your order at any time.

Lost the email? Open **My tickets** on the organizer's site or on Yayatoh, enter the email address you used, and we'll send you a code to see your tickets.

At the door, show the ticket's **QR code** on your phone or on paper.`,
  },
  {
    category: 'your-tickets',
    slug: 'pass-a-ticket-on',
    title: 'Pass a ticket on to someone else',
    summary: 'Send a ticket to a friend so it is in their name.',
    keywords: 'transfer, give ticket, friend, name change, holder',
    position: 20,
    body: `Open your order from the link in your confirmation email and choose **Pass it on** next to the ticket. Enter your friend's name and email address: they get their own link to the ticket, and the old QR code stops working.

Some organizers turn transfers off for their events; the order page says so.`,
  },
  {
    category: 'refunds-and-changes',
    slug: 'ask-for-a-refund',
    title: 'Ask for a refund',
    summary: 'Refunds follow the organizer’s refund policy, shown at checkout and on your order.',
    keywords: 'refund, money back, cancel ticket, refund policy',
    position: 10,
    body: `Each organizer sets their own **refund policy**. You can read it on your order page (the link in your confirmation email).

If a refund is possible, request it from your order page, or contact the organizer by replying to your confirmation email. When a refund is made, the money goes back to the card you paid with; banks usually take 5–10 business days to show it.`,
  },
  {
    category: 'refunds-and-changes',
    locale: 'ar',
    slug: 'ask-for-a-refund',
    title: 'طلب استرداد المبلغ',
    summary: 'يتبع الاسترداد سياسة المنظِّم المعروضة عند الدفع وفي صفحة طلبك.',
    keywords: 'استرداد, إلغاء تذكرة, سياسة الاسترداد',
    position: 10,
    body: `يحدد كل منظِّم **سياسة الاسترداد** الخاصة به. يمكنك قراءتها في صفحة طلبك (الرابط في رسالة التأكيد).

إذا كان الاسترداد ممكنًا، فاطلبه من صفحة طلبك أو تواصل مع المنظِّم بالرد على رسالة التأكيد. يُعاد المبلغ إلى البطاقة التي دفعت بها، وعادةً ما يستغرق ظهوره من 5 إلى 10 أيام عمل.`,
  },
  {
    category: 'refunds-and-changes',
    slug: 'cancelled-or-postponed-events',
    title: 'What happens if an event is cancelled or postponed',
    summary: 'You get an email; postponed tickets stay valid for the new date.',
    keywords: 'cancelled, postponed, new date, event changed, refund',
    position: 20,
    body: `If an event is **postponed**, your tickets stay valid for the new date and you get an email with the details.

If an event is **cancelled**, the organizer refunds the orders and you get an email when your refund is on its way.`,
  },
  {
    category: 'your-tickets',
    slug: 'wallet-passes',
    title: 'Add tickets to your phone wallet',
    summary: 'Coming soon.',
    keywords: 'wallet, apple wallet, google wallet',
    position: 30,
    body: 'Not written yet.',
    draft: true,
  },
];

export const STARTER_SECTIONS: readonly StarterSection[] = [
  {
    placement: 'home',
    slug: 'all-in-price',
    position: 10,
    eyebrow: 'Ticketing',
    heading: 'Prices with every fee included',
    body: 'Buyers see one price from the event page to the receipt. No surprises at checkout.',
  },
  {
    placement: 'home',
    slug: 'your-brand',
    position: 20,
    eyebrow: 'Your site',
    heading: 'Your events on your own domain',
    body: 'Run your event pages, blog and checkout on your own address, with your logo and colors.',
  },
  {
    placement: 'home',
    slug: 'door-ready',
    position: 30,
    eyebrow: 'Check-in',
    heading: 'Doors that keep working offline',
    body: 'Scan tickets on any phone. Check-in keeps going when the venue Wi-Fi does not.',
    cta: { label: 'See all features', href: '/features' },
  },
  {
    placement: 'features',
    slug: 'tickets-and-checkout',
    position: 10,
    eyebrow: 'Sell',
    heading: 'Tickets and checkout',
    body: `- Ticket types with prices, quantities and sale dates
- Promo codes and access codes
- A fast checkout with every fee included in the price`,
  },
  {
    placement: 'features',
    slug: 'seating',
    position: 20,
    eyebrow: 'Seat',
    heading: 'Seating charts and table plans',
    body: `- Draw rows, sections and round tables
- Buyers pick their seats; you can assign seats yourself
- A seat finder for guests on the day`,
  },
  {
    placement: 'features',
    slug: 'check-in',
    position: 30,
    eyebrow: 'Welcome',
    heading: 'Check-in that works offline',
    body: `- Scan on any phone or tablet, no app store needed
- Door staff devices without full accounts
- Live counts for your team`,
  },
  {
    placement: 'features',
    slug: 'messaging',
    position: 40,
    eyebrow: 'Talk',
    heading: 'Messages and announcements',
    body: `- Announcements on the event page and by email
- Replies from attendees in one inbox
- Consent-aware marketing emails`,
  },
  {
    placement: 'features',
    slug: 'money',
    position: 50,
    eyebrow: 'Get paid',
    heading: 'Payouts, refunds and reports',
    body: `- Payouts to your bank account
- Refunds in a few clicks, with your refund policy
- Sales and attendance reports`,
    cta: { label: 'Talk to us', href: '/contact' },
  },
  {
    placement: 'features',
    slug: 'coming-soon',
    position: 60,
    heading: 'Coming soon: a feature we have not announced',
    body: 'Draft section, not public.',
    draft: true,
  },
  {
    placement: 'contact',
    slug: 'sales',
    position: 10,
    eyebrow: 'Sales',
    heading: 'Planning events with Yayatoh?',
    body: 'Tell us about your events and how many tickets you sell a year. We will show you around and answer your questions.',
  },
  {
    placement: 'contact',
    slug: 'support',
    position: 20,
    eyebrow: 'Help',
    heading: 'Already using Yayatoh?',
    body: 'Most answers are in the help center. Ticket buyers: please contact the event organizer by replying to your confirmation email.',
    cta: { label: 'Visit the help center', href: '/help' },
  },
];
