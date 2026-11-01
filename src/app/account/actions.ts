'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { BookingError, describeBooking, type Booking } from '@/lib/booking';
import { createClientLoginToken, currentClient } from '@/lib/clientAuth';
import { sendBookingConfirmed, sendClientLoginLink } from '@/lib/email';
import { notifyPassReady, passLeftText, safely } from '@/lib/notify';
import { bookWithPass, createPassPurchase, expirePassPurchase, getPassType, setPassCheckoutId, type CustomerPass } from '@/lib/passes';
import { passSummary } from '@/lib/passText';
import { appUrl, createPassCheckout } from '@/lib/stripe';
import type { FormState } from '@/app/actions';

// Only allow sending people back to a page on this site
function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? '');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

export async function requestClientLink(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim();
  if (!email) return { error: 'Please enter your email address.' };
  const next = safeNext(form.get('next'));
  const result = await createClientLoginToken(getDb(), email);
  if (result) {
    const link = `${appUrl()}/account/auth?token=${encodeURIComponent(result.token)}&next=${encodeURIComponent(next)}`;
    await safely(() => sendClientLoginLink(result.customer.email, result.customer.name, link));
  }
  // Same message either way, so the form doesn't reveal who has booked
  return { ok: "If you've booked with us using that email, a sign-in link is on its way. Check your inbox (and junk folder)." };
}

export async function bookWithPassAction(_prev: FormState, form: FormData): Promise<FormState> {
  const db = getDb();
  const customer = await currentClient(db);
  const sessionId = Number(form.get('sessionId'));
  if (!customer) redirect(`/account/login?next=/class/${sessionId}`);
  if (form.get('agree') !== 'on') return { error: 'Please tick to agree to the booking and refund policy.' };
  let booking: Booking;
  try {
    booking = await bookWithPass(db, { sessionId, customerId: customer.id, passId: String(form.get('passId') ?? '') || undefined });
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    throw error;
  }
  const desc = await describeBooking(db, booking);
  const left = await passLeftText(db, booking.passId);
  await safely(() => sendBookingConfirmed(desc, left));
  redirect(`/booking/${booking.manageToken}`);
}

export async function buyPass(_prev: FormState, form: FormData): Promise<FormState> {
  if (String(form.get('website') ?? '') !== '') return { error: 'Something went wrong. Please try again.' };
  if (form.get('agree') !== 'on') return { error: 'Please tick to agree to the pass terms.' };
  const db = getDb();
  const passTypeId = Number(form.get('passTypeId'));
  const signedIn = await currentClient(db);
  const customer = signedIn
    ? { name: signedIn.name, email: signedIn.email, phone: signedIn.phone }
    : { name: String(form.get('name') ?? ''), email: String(form.get('email') ?? ''), phone: String(form.get('phone') ?? '') };
  let pass: CustomerPass;
  try {
    pass = await createPassPurchase(db, { passTypeId, customer });
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    throw error;
  }
  if (pass.status === 'active') {
    await notifyPassReady(db, pass.id);
    redirect(`/passes/done/${pass.id}`);
  }
  let url: string;
  try {
    const type = await getPassType(db, passTypeId);
    const checkout = await createPassCheckout(pass, type!, customer.email.trim().toLowerCase(), passSummary(type!), `/passes/${passTypeId}`);
    await setPassCheckoutId(db, pass.id, checkout.id);
    url = checkout.url;
  } catch (error) {
    console.error('Could not start Stripe checkout for a pass', error);
    await expirePassPurchase(db, pass.id);
    return { error: "Sorry, we couldn't start the payment. Please try again in a moment." };
  }
  redirect(url);
}
