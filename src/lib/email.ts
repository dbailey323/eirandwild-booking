// Emails are sent through Resend's API. Without a RESEND_API_KEY (local development)
// they are printed to the console instead.

import { formatPence } from './money';
import { REFUND_POLICY } from './policy';
import { formatDay, formatTimeRange } from './time';
import type { BookingDescription } from './booking';
import { appUrl } from './stripe';

type Email = { to: string; subject: string; html: string };

export async function sendEmail({ to, subject, html }: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    console.log(`\n[email] to: ${to}\n[email] subject: ${subject}\n${text}\n[email] links: ${links.join(' ')}\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? 'Eir & Wild <bookings@eirandwild.co.uk>',
      reply_to: process.env.EMAIL_REPLY_TO ?? 'hello@eirandwild.co.uk',
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${await res.text()}`);
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Light and dark versions are both spelled out, so email apps in dark mode use these
// colours instead of inverting the navy header into a washed-out lilac
const EMAIL_STYLES = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  .ew-header { background:#000562 !important; }
  @media (prefers-color-scheme: dark) {
    .ew-body { background:#11121a !important; }
    .ew-card { background:#1d1e2b !important; border-color:#2c2e40 !important; }
    .ew-text, .ew-text p, .ew-text li { color:#e8e8f0 !important; }
    .ew-title { color:#FFD700 !important; }
    .ew-muted { color:#a9abbd !important; }
    .ew-btn { background:#FFD700 !important; color:#000562 !important; }
    .ew-link { color:#7ae1d5 !important; }
  }
  [data-ogsc] .ew-body { background:#11121a !important; }
  [data-ogsc] .ew-card { background:#1d1e2b !important; }
  [data-ogsc] .ew-title { color:#FFD700 !important; }
  [data-ogsc] .ew-btn { background:#FFD700 !important; color:#000562 !important; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en-GB"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>${EMAIL_STYLES}</style></head>
<body class="ew-body" style="margin:0;padding:0;background:#f7faf9;font-family:Montserrat,Arial,Helvetica,sans-serif;color:#333333">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div class="ew-header" style="background:#000562;border-radius:16px 16px 0 0;padding:20px 24px;text-align:center">
    <img src="${appUrl()}/email/logo.png" width="180" alt="Eir &amp; Wild Wellness" style="display:inline-block;width:180px;max-width:100%;height:auto;border:0">
  </div>
  <div class="ew-card ew-text" style="background:#ffffff;border:1px solid #e0e8e6;border-top:0;border-radius:0 0 16px 16px;padding:26px 24px;color:#333333;font-size:15px;line-height:1.6">
    <h1 class="ew-title" style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#000562">${esc(title)}</h1>
    ${body}
  </div>
  <p class="ew-muted" style="font-size:12px;line-height:1.6;color:#888888;text-align:center;margin:16px 0 0">Eir &amp; Wild Wellness · Mountsorrel &amp; Rothley, Leicestershire<br>
  Questions? Reply to this email or WhatsApp Lara on 07885 899947.</p>
</div></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a class="ew-btn" href="${href}" style="display:inline-block;background:#000562;color:#FFD700;padding:13px 26px;border-radius:30px;text-decoration:none;font-weight:700;font-size:15px">${esc(label)}</a></p>`;
}

function sessionList(desc: BookingDescription): string {
  const items = desc.sessions
    .map((s) => {
      const where = s.location ? ` · ${esc(s.location.name)}` : '';
      return `<li style="margin-bottom:6px"><strong>${esc(formatDay(s.session.startsAt))}</strong>, ${esc(formatTimeRange(s.session.startsAt, s.session.endsAt))}${where}</li>`;
    })
    .join('');
  return `<ul style="padding-left:18px">${items}</ul>`;
}

function venueDetails(desc: BookingDescription): string {
  const loc = desc.sessions[0]?.location;
  if (!loc) return '';
  return loc.online
    ? '<p>This class is online. Your Zoom link will be shared before the class.</p>'
    : `<p><strong>Where:</strong> ${esc(loc.name)}${loc.address ? `, ${esc(loc.address)}` : ''}</p>`;
}

export function manageLink(desc: BookingDescription): string {
  return `${appUrl()}/booking/${desc.booking.manageToken}`;
}

export async function sendBookingConfirmed(desc: BookingDescription, passLeft?: string) {
  const paid = desc.booking.paymentMethod === 'pass'
    ? `<p><strong>Paid with:</strong> your pass${passLeft ? ` (${esc(passLeft)})` : ''}</p>`
    : desc.booking.amountPence > 0 ? `<p><strong>Paid:</strong> ${formatPence(desc.booking.amountPence)}</p>` : '';
  await sendEmail({
    to: desc.customer.email,
    subject: `You're booked: ${desc.title}`,
    html: layout(`You're booked, ${desc.customer.name}!`, `
      <p>Thank you for booking <strong>${esc(desc.title)}</strong>. Here are your details:</p>
      ${sessionList(desc)}
      ${venueDetails(desc)}
      ${paid}
      ${button(manageLink(desc), 'View or cancel your booking')}
      <p class="ew-muted" style="font-size:13px;color:#666666">${REFUND_POLICY.map(esc).join(' ')}</p>
      <p>See you soon!<br>Lara x</p>`),
  });
}

export async function sendBookingCancelled(desc: BookingDescription, refundedPence: number, creditReturned = false) {
  const refund = refundedPence > 0
    ? `<p>A refund of <strong>${formatPence(refundedPence)}</strong> is on its way to your card. It usually arrives within 5 to 10 working days.</p>`
    : creditReturned
      ? '<p>The class has gone back on your pass, ready to book another.</p>'
      : desc.booking.paymentMethod === 'pass'
        ? '<p>As this was within 4 hours of the class, the class has not gone back on your pass.</p>'
        : desc.booking.amountPence > 0 ? '<p>As this was within the cancellation period, no refund is due.</p>' : '';
  await sendEmail({
    to: desc.customer.email,
    subject: `Booking cancelled: ${desc.title}`,
    html: layout('Your booking has been cancelled', `
      <p>Your booking for <strong>${esc(desc.title)}</strong> has been cancelled.</p>
      ${sessionList(desc)}
      ${refund}
      ${button(appUrl(), 'Book another class')}`),
  });
}

export async function sendClassCancelled(to: string, name: string, title: string, when: Date, refundedPence: number, kind: string, creditReturned = false) {
  const refund = refundedPence > 0
    ? `<p>You've been refunded <strong>${formatPence(refundedPence)}</strong> in full.</p>`
    : creditReturned
      ? '<p>The class has gone back on your pass.</p>'
      : kind === 'course'
      ? '<p>Lara will be in touch about a make-up session.</p>'
      : '';
  await sendEmail({
    to,
    subject: `Class cancelled: ${title}, ${formatDay(when)}`,
    html: layout(`Sorry ${name}, this class is cancelled`, `
      <p>Unfortunately <strong>${esc(title)}</strong> on <strong>${esc(formatDay(when))}</strong> has had to be cancelled.</p>
      ${refund}
      ${button(appUrl(), 'See other classes')}`),
  });
}

export async function sendWaitlistSpace(to: string, name: string, title: string, link: string) {
  await sendEmail({
    to,
    subject: `A space has opened: ${title}`,
    html: layout(`Good news, ${name}!`, `
      <p>A space has opened up on <strong>${esc(title)}</strong>. Everyone on the waiting list has been told, so it's first come, first served.</p>
      ${button(link, 'Book the space')}`),
  });
}

export async function sendReminder(to: string, name: string, title: string, start: Date, end: Date, where: string, manage: string) {
  await sendEmail({
    to,
    subject: `See you tomorrow: ${title}`,
    html: layout(`See you tomorrow, ${name}!`, `
      <p>Just a reminder that you're booked on <strong>${esc(title)}</strong>:</p>
      <p><strong>${esc(formatDay(start))}</strong>, ${esc(formatTimeRange(start, end))}<br>${esc(where)}</p>
      ${button(manage, 'View your booking')}`),
  });
}

export async function sendAdminLoginLink(to: string, link: string) {
  await sendEmail({
    to,
    subject: 'Your Eir & Wild admin sign-in link',
    html: layout('Sign in to Eir & Wild bookings', `
      <p>Tap the button below to sign in. The link works once and expires in 20 minutes.</p>
      ${button(link, 'Sign in')}
      <p class="ew-muted" style="font-size:13px;color:#666666">If you didn't ask for this, you can ignore this email.</p>`),
  });
}

export async function sendClientLoginLink(to: string, name: string, link: string) {
  await sendEmail({
    to,
    subject: 'Your Eir & Wild sign-in link',
    html: layout(`Hi ${name}`, `
      <p>Tap the button below to sign in to your Eir &amp; Wild account, where you can see your bookings and passes. The link works once and expires in an hour.</p>
      ${button(link, 'Sign in')}
      <p class="ew-muted" style="font-size:13px;color:#666666">If you didn't ask for this, you can ignore this email.</p>`),
  });
}

export async function sendPassConfirmed(
  to: string,
  name: string,
  pass: { name: string; credits: string; classes: string; until: string | null; amountPence: number },
) {
  await sendEmail({
    to,
    subject: `Your pass is ready: ${pass.name}`,
    html: layout(`Your pass is ready, ${name}!`, `
      <p>Thank you for buying <strong>${esc(pass.name)}</strong>.</p>
      <ul style="padding-left:18px">
        <li><strong>Covers:</strong> ${esc(pass.credits)}</li>
        <li><strong>For:</strong> ${esc(pass.classes)}</li>
        ${pass.until ? `<li><strong>Use by:</strong> ${esc(pass.until)}</li>` : ''}
        ${pass.amountPence > 0 ? `<li><strong>Paid:</strong> ${formatPence(pass.amountPence)}</li>` : ''}
      </ul>
      <p>To book a class with your pass, sign in with this email address and choose <strong>Book with my pass</strong> on any class it covers.</p>
      ${button(`${appUrl()}/account/login`, 'Sign in and book')}
      <p>See you soon!<br>Lara x</p>`),
  });
}
