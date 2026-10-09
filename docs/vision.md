# Yayatoh.com Rebuild — Project Vision and Goal

> Source: owner's vision document (`Yayatoh.com Rebuild - Project Vision and Goal.docx`), converted to Markdown 2026-09-26. The owner's words; do not edit except to correct conversion errors.


The goal of this project is not simply to convert the current Yayatoh.com platform from Laravel to Next.js.


We want to use this rebuild as an opportunity to create a much better, more modern, scalable, flexible and future-ready version of Yayatoh.


The current Yayatoh platform already has many important features that we want to preserve, including event creation, ticket sales, attendee management, QR tickets, check-in, duplicate check-in prevention, fraud detection, reserved seating, table and seat management, ticket distribution, guest import, seat finder, event discovery and other existing event-management capabilities.


The new platform should keep the important features that already work, improve the ones that need improvement and add major new capabilities.


The objective is to transform Yayatoh from primarily an event ticketing and management platform into a complete Event Operating System that can support many different types of events and organizations.


The final system should allow an organization to manage the complete event lifecycle from one platform:


Create → Promote → Register → Sell → Manage → Seat → Communicate → Engage → Check In → Analyze


## 1. Rebuild the Existing Platform Better

We are not starting from zero.  

The developer should first understand what already exists in the current Laravel version of Yayatoh and preserve the important functionality.

The Next.js version should improve:  
- Performance
- User experience
- Design
- Navigation
- Mobile responsiveness
- Security
- Maintainability
- Scalability
- Database structure where necessary
- API architecture
- Real-time capabilities
- Reporting
- Integrations

We do not want a simple copy of the Laravel interface using Next.js.

We want Yayatoh 2.0.  

## 2. Make Yayatoh Multi-Tenant


One of the most important objectives is to make the new system properly multi-tenant.


Organizations should be able to have their own account and manage multiple events under the same organization.

For example:  
Yayatoh Platform  
→ Organization A→ Organization B→ Organization C  
Each organization can have:  
- Its own users
- Its own events
- Its own attendees
- Its own customers
- Its own branding
- Its own settings
- Its own marketing campaigns
- Its own reports
- Its own integrations
- Its own payment configuration where applicable

The data belonging to one organization must remain isolated from other organizations.


This architecture is very important because we want Yayatoh to eventually serve small organizers, large organizations, corporations, event agencies, associations, churches, conference organizers, wedding planners and other businesses.


## 3. Make Yayatoh White-Label

The new system should support white-labeling.  

An organization should eventually be able to operate its own event platform powered by Yayatoh while presenting its own brand to customers.

Organizations should be able to customize things such as:  
- Logo
- Colors
- Branding
- Event pages
- Registration pages
- Emails
- Custom domain
- Navigation
- Communication templates
- Other appearance settings
For example, an organization may want to use:  
events.organization.com  

while Yayatoh remains the technology powering everything behind the scenes.


This should be considered from the beginning when designing the architecture.


## 4. Keep and Improve Our Mobile Apps


Yayatoh already has mobile applications available through Google Play and the Apple App Store.

The rebuild should not abandon the mobile apps.  

The new Next.js platform must continue supporting the mobile applications through a clean, stable and properly documented API.


The developer should review how the current applications communicate with the Laravel backend and create a migration strategy so that the mobile apps continue working during and after the transition.


The architecture should also allow us to improve the mobile applications in the future without being limited by the new web platform.


The mobile API should therefore be treated as an important part of the system rather than an afterthought.


## 5. Add Enterprise Event Management Features


We want Yayatoh to eventually support much larger and more complex events.


Platforms such as RainFocus provide good examples of the type of enterprise functionality we want Yayatoh to grow into.

We want to add capabilities such as:  
- Advanced registration
- Custom registration forms
- Conditional registration questions
- Conference agendas
- Tracks
- Sessions
- Speakers
- Session registration
- Session capacity
- Session check-in
- Exhibitors
- Sponsors
- Sponsor packages
- Exhibitor portals
- Speaker portals
- Badge creation
- Badge printing
- Lead retrieval
- Attendee engagement
- Surveys
- Polls
- Networking
- Advanced analytics
These features should work as modules.  
Not every customer needs everything.  

A concert organizer should not have to deal with conference sessions and exhibitors.

A conference organizer may need all of them.  

## 6. Improve Weddings, Galas and Social Events


We also want Yayatoh to become very strong for weddings, galas, banquets and similar events.


Platforms such as SeatFound and Venued provide good examples of simple guest and seating experiences.


Yayatoh already has significant seating functionality, so the goal is to improve and package it better.

We want features such as:  
- Guest lists
- RSVP
- Plus-ones
- Guest groups
- CSV/Excel import
- Visual floor plans
- Drag-and-drop seating
- Tables
- Individual seats
- Sections
- VIP areas
- Guest seat assignments
- QR seat finder
- Name lookup
- "Find My Seat"
- Interactive venue map
- Event program
- Photo/video gallery
- Wedding/event information
- Kiosk/display mode

A person organizing a wedding should be able to use Yayatoh without seeing all the complexity of the enterprise conference features.


## 7. Build a Powerful Dashboard


The dashboard should become one of the strongest features of Yayatoh.

We do not want a basic dashboard showing only ticket sales.  
We want an Event Command Center.  

Depending on the user's role, the dashboard should show relevant information such as:

- Revenue
- Ticket sales
- Registrations
- Orders
- Attendees
- Check-ins
- Attendance percentage
- Seat assignments
- Tickets distributed
- Tickets claimed
- Refunds
- Marketing performance
- Session attendance
- Exhibitor activity
- Sponsor activity
- Event readiness
- Operational alerts
The dashboard should identify problems automatically.  
Examples:  
- 37 attendees do not have seats.
- 120 purchased tickets have not been distributed.
- 42 guests have not responded to RSVP.
- 14 payments failed.
- A session has reached 95% capacity.
- Three check-in devices are offline.

On the day of an event, the dashboard should become more operational and show information such as:

- Live check-ins
- Check-in speed
- Entry locations
- Duplicate scan attempts
- Invalid tickets
- Scanner/device status
- Guest assistance
- Venue capacity
- Session capacity
Where appropriate, information should update in real time.  

## 8. Add a Powerful Marketing and Communication System

Marketing should become a major part of Yayatoh.  

Organizers should not have to export attendee lists to several different platforms just to communicate with their audience.

Yayatoh should eventually support communication through:  
- Email
- SMS
- WhatsApp
- Push notifications
- In-app notifications

Organizers should be able to create audiences based on information already inside Yayatoh.

For example:  
Send a message to:  

VIP attendees who purchased tickets but have not selected their seats.

Or:  

People who attended last year's event but have not registered this year.

Or:  
Registered attendees who have not checked in yet.  
We also want marketing automation.  
For example:  
Ticket purchased→ Confirmation email  
7 days before event→ Reminder  
24 hours before event→ SMS/WhatsApp  
Event day→ Push notification  
After event→ Survey  

The marketing system should also provide analytics showing what campaigns generated registrations and ticket sales.


## 9. Improve Check-In and Onsite Operations


Yayatoh's check-in functionality is already very important and should become even stronger.

We want:  
- QR scanning
- Name lookup
- Phone lookup
- Email lookup
- Manual check-in
- Duplicate scan detection
- Fraud detection
- Multiple entrances
- Multiple check-in devices
- Real-time check-in information
- Check-in history

We also want the check-in system to continue working when venue internet is poor or temporarily unavailable.


The developer should design an offline-capable solution where appropriate so that an internet outage does not completely stop event entry.


## 10. Improve Seating

Seating should become one of Yayatoh's flagship features.  
We want a modern visual seating environment supporting:  
- Tables
- Seats
- Sections
- Stages
- Booths
- Entrances
- Dance floors
- Custom objects
- Drag and drop
- Guest assignments
- Group assignments
- Seat lookup
- Interactive floor maps

We also want the architecture to support intelligent seating assistance in the future.

For example:  
"Keep members of the same association together."  
or:  
"Place VIP tables closest to the stage."  

## 11. Build a Strong Attendee/Customer Database

An attendee should not exist only inside one event.  

Organizations should gradually be able to build a complete history of their customers and attendees.

For example:  
John Doe  
- Attended Event A
- Purchased VIP at Event B
- Registered for Event C
- Attended 4 conference sessions
- Opened previous email campaigns
- Purchased $1,800 worth of tickets over time

This information can then help organizers understand their audience and run better marketing campaigns.


In other words, Yayatoh should gradually function as an Event CRM as well.


## 12. Build for Different Event Types Without Making the System Complicated


A major goal is to create a powerful system without making the user experience complicated.

Different customers should see different workflows.  
A wedding organizer may see:  
Guests | RSVP | Seating | Seat Finder | Gallery  
A concert organizer may see:  
Tickets | Marketing | Check-In | Sales  
A conference organizer may see:  

Registration | Sessions | Speakers | Exhibitors | Sponsors | Badges | Check-In | Analytics

An event agency may see:  
Clients | Events | Marketing | Reports  

The platform can be complex internally while remaining simple for each type of customer.


## 13. Make the Platform Modular and Future-Ready


The new architecture should make it easy to add additional modules in the future.


We do not want to rebuild the entire platform every time Yayatoh grows.


The system should be designed around logical modules such as:

- Events
- Ticketing
- Registration
- Orders
- Payments
- Attendees
- Seating
- Check-in
- Sessions
- Speakers
- Exhibitors
- Sponsors
- Marketing
- Notifications
- Analytics
- Integrations
- White Label

They should work together while remaining organized enough to evolve independently.


## 14. Improve APIs and Integrations

The new Yayatoh should have a clean API architecture.  
This is important for:  
- Existing Yayatoh mobile apps
- Future mobile apps
- Third-party integrations
- White-label customers
- External applications
- Future partners

We also want to make it easier to integrate with services such as:

- Stripe
- WhatsApp
- SMS providers
- Email providers
- Salesforce
- HubSpot
- Google Sheets
- Zoom
- Other marketing and CRM systems
Where appropriate, Yayatoh should also support webhooks.  

## 15. Modernize the Overall User Experience


The new platform should feel like a premium modern SaaS application.

We want:  
- Clean navigation
- Modern design
- Faster pages
- Better mobile experience
- Fewer confusing forms
- Better search
- Better filtering
- Bulk actions
- Better reports
- Clear notifications
- Guided workflows
- Better onboarding
- Better error messages
- Better event creation
- Consistent design throughout the system

The purpose of moving to Next.js is not simply to change the programming framework.


The user should immediately notice that the new Yayatoh is significantly better than the existing platform.


## Overall Goal

The best way to understand this project is:  
We are not simply rebuilding Yayatoh.com in Next.js.  

We are taking everything valuable that already exists in Yayatoh and using the rebuild as an opportunity to create a much more powerful product.


We want to preserve what works, improve what can be improved and add the capabilities necessary for Yayatoh to compete in several parts of the event-management market.

The long-term vision is:  

## Yayatoh — The Event Operating System

A platform where organizations can:  

Create events.Promote events.Manage registrations.Sell tickets.Manage guests.Build seating plans.Communicate with attendees.Manage conferences.Manage exhibitors and sponsors.Operate check-in.Run events onsite.Analyze performance.And offer the entire experience under their own brand.


The most important objective is not how the developer chooses to technically implement every feature.


The most important objective is achieving this product vision while creating a platform that is:


Modern, scalable, maintainable, secure, modular, multi-tenant, white-label, mobile-compatible and future-ready.


The developer should use his technical expertise to recommend the best architecture and implementation strategy to achieve this goal while ensuring that the existing Yayatoh functionality and users transition successfully to the new platform.

