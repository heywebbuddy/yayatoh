# How messaging works in Yayatoh

A short guide for the client: what kinds of messages exist, where to find each one, and what happens when someone writes. Screenshots are in this folder (desktop and phone, light and dark).

## 1. Attendee to attendee (private chat)

**Where:** My dashboard → **Networking** (or the event page → **Meet other attendees**) → the **Chats** tab.
Open a person from **People** or **Connections** and choose **Send … a message**.

- You can only write to people you are **connected** with (or have a meeting with). Connect from their profile first; they accept the request.
- Press **Enter** to send (**Shift + Enter** for a new line). Messages are up to 2,000 characters.
- New messages appear on the open page by themselves; there is no need to reload.
- **Unread counts:** a small number sits on the **Chats** tab and on each chat in the list. It clears when the chat is opened.
- Every chat has **Block or report**; a report also blocks that person for you, and the organizer can review it.

Screenshots: `messaging-chat-list-*.png`, `messaging-chat-thread-*.png`.

## 2. Event lobby (one room for everyone)

**Where:** Networking → **Lobby** tab. The organizer switches the lobby on per event (Networking settings).

- Everyone who joined networking can read and write in the lobby.
- Write your message and press **Send**.
- The **Lobby** tab shows an unread count for what you have not seen. Individual messages can be reported.

Screenshots: `messaging-lobby-*.png`.

## 3. Booth chat (attendee to exhibitor)

**Where:** Networking → **Chats** → **Chat with exhibitors**, then **Chat** next to a booth.

- Only booths whose exhibitor has **switched booth chat on** (in the exhibitor portal) appear here. The organizer can suspend a booth.
- The attendee writes; the exhibitor's booth team answers from the **exhibitor portal → Chat**, where they see their own unread count.
- Either side can block; the attendee can report the chat.

Screenshots: `messaging-booth-chat-*.png`.

## 4. Organizer to attendees (announcements) and replies

**Where (organizer):** Event → **Marketing** → **New announcement**.

1. Write a subject and message, choose how to send it: **Email**, **Push notification**, **SMS** (SMS only to guests who agreed to texts).
2. **Preview** shows exactly what attendees will get and how many people it reaches, then **Send to N people**.
3. The **Sent announcements** list shows when it was sent, to how many people, and the delivery result.

Attendees get the announcement by email (and push where they turned it on). **Replies come back to the organizer's inbox**: Organization menu → **Messages**. The organizer answers there; the answer goes to the attendee by email, and the attendee can continue the conversation from the link in that email.

Screenshots: `messaging-org-announcement-compose.png`, `messaging-org-announcement-preview.png`, `messaging-org-announcement-sent.png`, `messaging-org-inbox.png`.

## What notifies whom

| Event | In the app | Email / push |
| --- | --- | --- |
| New private chat message | Unread number on **Chats** and on the chat; live update when open | No email for each chat message (by design, so chats do not flood inboxes) |
| New lobby message | Unread number on **Lobby**; live update when open | No |
| Booth question | Unread number in the exhibitor portal | No |
| Organizer announcement | Sent to everyone chosen | Email, push and/or SMS |
| Attendee reply to an announcement | Unread conversation in the organizer's **Messages** | The organizer's answer is emailed to the attendee |

## Public pages added in this round

About us (`/about`), Contact (`/contact`, with a staff inbox under **Contact messages** in the admin panel), and the legal pages (`/privacy`, `/terms`, `/cookies`, `/sub-processors`), all editable in the admin panel under **Site content**.
