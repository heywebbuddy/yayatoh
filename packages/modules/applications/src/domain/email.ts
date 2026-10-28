const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface PlainEmail {
  readonly subject: string;
  /** Blank-line separated paragraphs. */
  readonly body: string;
  readonly cta?: { readonly label: string; readonly url: string } | null;
}

/** Only these URL schemes become links; anything else stays text. */
const safeUrl = (u: string) => (/^https?:\/\/[^\s"<>]+$/i.test(u) ? u : null);

/**
 * A plain, accessible email (text and HTML) for staff-written and system messages from the
 * applications queue: paragraphs, one optional button. Everything is escaped; the text version
 * carries the link in full.
 */
export function renderPlainEmail(m: PlainEmail): { subject: string; html: string; text: string } {
  const paragraphs = m.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const url = m.cta ? safeUrl(m.cta.url) : null;
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:560px">',
    ...paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`),
    url && m.cta
      ? `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;border-radius:999px;text-decoration:none;font-weight:700">${escapeHtml(m.cta.label)}</a></p><p style="font-size:13px;color:#555555">${escapeHtml(url)}</p>`
      : '',
    '</div>',
  ].join('');
  const text = [...paragraphs, url && m.cta ? `${m.cta.label}: ${url}` : ''].filter(Boolean).join('\n\n');
  return { subject: m.subject, html, text };
}

export interface ApplicantFacts {
  readonly contactName: string;
  readonly orgName: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The editable starting points staff see before they send a "needs info" or "reject" email. */
export function defaultDecisionEmail(kind: 'needs_info' | 'rejected', a: ApplicantFacts): PlainEmail {
  if (kind === 'needs_info')
    return {
      subject: `Yayatoh: a few more details about ${a.orgName}`,
      body: `Hi ${first(a.contactName)},\n\nThank you for applying to become an organizer on Yayatoh. Before we can decide, we need a little more information:\n\n- \n\nJust reply to this email with the details and we will pick it up right away.\n\nThe Yayatoh team`,
    };
  return {
    subject: `Your Yayatoh application for ${a.orgName}`,
    body: `Hi ${first(a.contactName)},\n\nThank you for your interest in Yayatoh and for the time you took to apply. After a careful look we are not able to open an organizer account for ${a.orgName} at this time.\n\nThis is not a judgement of your events. If your plans change, you are welcome to apply again.\n\nThe Yayatoh team`,
  };
}

/** The invitation staff approve; the signup link carries the one-time code. */
export function invitationEmail(
  a: ApplicantFacts & { plan: string; planName: string; days: number },
  signupUrl: string,
  note?: string,
): PlainEmail {
  return {
    subject: `You're approved: create your Yayatoh organizer account`,
    body: [
      `Hi ${first(a.contactName)},`,
      `Good news: ${a.orgName} has been approved as an organizer on Yayatoh, on the ${a.planName} plan.`,
      note?.trim() || '',
      `Use the button below to create your account. The link works once, only for the email address you applied with, and expires in ${a.days} days. After you sign up you will land on your setup checklist.`,
      'The Yayatoh team',
    ]
      .filter(Boolean)
      .join('\n\n'),
    cta: { label: 'Create your account', url: signupUrl },
  };
}
