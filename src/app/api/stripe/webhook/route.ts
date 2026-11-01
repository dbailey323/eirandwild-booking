import type Stripe from 'stripe';
import { getDb } from '@/db';
import { confirmBooking, describeBooking, expireBooking } from '@/lib/booking';
import { sendBookingConfirmed } from '@/lib/email';
import { notifyWaitlist, safely } from '@/lib/notify';
import { stripe } from '@/lib/stripe';

// Stripe calls this when a checkout is paid or expires. Configure it in the Stripe
// dashboard (Developers > Webhooks) for checkout.session.completed,
// checkout.session.async_payment_succeeded and checkout.session.expired.
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return new Response('Missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch (error) {
    console.error('Stripe webhook signature check failed', error);
    return new Response('Invalid signature', { status: 400 });
  }

  const db = getDb();
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const checkout = event.data.object;
    const bookingId = checkout.metadata?.booking_id;
    if (bookingId && checkout.payment_status === 'paid') {
      const paymentIntentId = typeof checkout.payment_intent === 'string' ? checkout.payment_intent : checkout.payment_intent?.id;
      const { booking, changed } = await confirmBooking(db, bookingId, { paymentIntentId });
      if (changed) await safely(async () => sendBookingConfirmed(await describeBooking(db, booking)));
    }
  } else if (event.type === 'checkout.session.expired') {
    const bookingId = event.data.object.metadata?.booking_id;
    if (bookingId) {
      const freed = await expireBooking(db, bookingId);
      await notifyWaitlist(db, freed);
    }
  }
  return Response.json({ received: true });
}
