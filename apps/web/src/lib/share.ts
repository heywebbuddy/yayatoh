/**
 * A WhatsApp share link: opens WhatsApp (app or web) with the text ready to send to anyone, no
 * number needed. The text is the only thing that travels; it is URL-encoded once, here.
 */
export const whatsappHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
