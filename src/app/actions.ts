'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import {
  BookingError,
  cancelBooking,
  createCourseBooking,
  createSessionBooking,
  describeBooking,
  expireBooking,
  getBookingByToken,
  joinWaitlist,
  setCheckoutId,
  type Booking,
} from '@/lib/booking';
import { sendBookingCancelled, sendBookingConfirmed } from '@/lib/email';
import { notifyWaitlist, safely } from '@/lib/notify';
import { createCheckout, refundPayment } from '@/lib/stripe';

export type FormState = { error?: string; ok?: string };

function customerFrom(form: FormData) {
  return {
    name: String(form.get('name') ?? ''),
    email: String(form.get('email') ?? ''),
    phone: String(form.get('phone') ?? ''),
  };
}

function voucherFrom(form: FormData) {
  return String(form.get('voucher') ?? '').trim() || undefined;
}

// Simple spam trap: a field people can't see, which bots tend to fill in
function looksLikeSpam(form: FormData) {
  return String(form.get('website') ?? '') !== '';
}

async function finishBooking(booking: Booking, cancelPath: string): Promise<FormState> {
  const db = getDb();
  const desc = await describeBooking(db, booking);
  if (booking.status === 'confirmed') {
    await safely(() => sendBookingConfirmed(desc));
    redirect(`/booking/${booking.manageToken}`);
  }
  let url: string;
  try {
    const checkout = await createCheckout(desc, cancelPath);
    await setCheckoutId(db, booking.id, checkout.id);
    url = checkout.url;
  } catch (error) {
    console.error('Could not start Stripe checkout', error);
    await expireBooking(db, booking.id);
    return { error: "Sorry, we couldn't start the payment. Please try again in a moment." };
  }
  redirect(url);
}

export async function bookSession(_prev: FormState, form: FormData): Promise<FormState> {
  if (looksLikeSpam(form)) return { error: 'Something went wrong. Please try again.' };
  if (form.get('agree') !== 'on') return { error: 'Please tick to agree to the booking and refund policy.' };
  const sessionId = Number(form.get('sessionId'));
  let booking: Booking;
  try {
    booking = await createSessionBooking(getDb(), { sessionId, customer: customerFrom(form), voucherCode: voucherFrom(form) });
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    throw error;
  }
  return finishBooking(booking, `/class/${sessionId}`);
}

export async function bookCourse(_prev: FormState, form: FormData): Promise<FormState> {
  if (looksLikeSpam(form)) return { error: 'Something went wrong. Please try again.' };
  if (form.get('agree') !== 'on') return { error: 'Please tick to agree to the booking and refund policy.' };
  const courseId = Number(form.get('courseId'));
  let booking: Booking;
  try {
    booking = await createCourseBooking(getDb(), { courseId, customer: customerFrom(form), voucherCode: voucherFrom(form) });
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    throw error;
  }
  return finishBooking(booking, `/course/${courseId}`);
}

export async function joinWaitlistAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (looksLikeSpam(form)) return { error: 'Something went wrong. Please try again.' };
  const sessionId = form.get('sessionId') ? Number(form.get('sessionId')) : undefined;
  const courseId = form.get('courseId') ? Number(form.get('courseId')) : undefined;
  try {
    await joinWaitlist(getDb(), { sessionId, courseId, customer: customerFrom(form) });
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    throw error;
  }
  return { ok: "You're on the waiting list. We'll email you if a space opens up." };
}

export async function cancelOwnBooking(_prev: FormState, form: FormData): Promise<FormState> {
  const db = getDb();
  const token = String(form.get('token') ?? '');
  const desc = await getBookingByToken(db, token);
  if (!desc) return { error: 'Booking not found.' };
  try {
    const result = await cancelBooking(db, desc.booking.id, { refund: refundPayment });
    const updated = await getBookingByToken(db, token);
    if (updated && desc.booking.status === 'confirmed') await safely(() => sendBookingCancelled(updated, result.refundedPence, result.creditReturned, result.voucherReturnedPence));
    await notifyWaitlist(db, result.freedSessionIds);
    return {
      ok: result.refundedPence > 0
        ? 'Your booking is cancelled and your refund is on its way.'
        : result.voucherReturnedPence > 0
          ? 'Your booking is cancelled and the money is back on your gift voucher.'
          : result.creditReturned
          ? 'Your booking is cancelled and the class is back on your pass.'
          : 'Your booking is cancelled.',
    };
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    console.error('Cancellation failed', error);
    return { error: "Sorry, we couldn't cancel that just now. Please contact Lara." };
  }
}
