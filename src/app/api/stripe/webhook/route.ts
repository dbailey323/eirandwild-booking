import type Stripe from 'stripe';
import { getDb } from '@/db';
import { confirmBooking, describeBooking, expireBooking } from '@/lib/booking';
import { sendBookingConfirmed } from '@/lib/email';
import { notifyPassReady, notifyWaitlist, safely } from '@/lib/notify';
import { activatePass, expirePassPurchase } from '@/lib/passes';
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
    const passId = checkout.metadata?.pass_id;
    const paymentIntentId = typeof checkout.payment_intent === 'string' ? checkout.payment_intent : checkout.payment_intent?.id;
    if (bookingId && checkout.payment_status === 'paid') {
      const { booking, changed } = await confirmBooking(db, bookingId, { paymentIntentId });
      if (changed) await safely(async () => sendBookingConfirmed(await describeBooking(db, booking)));
    }
    if (passId && checkout.payment_status === 'paid') {
      const { changed } = await activatePass(db, passId, { paymentIntentId });
      if (changed) await notifyPassReady(db, passId);
    }
  } else if (event.type === 'checkout.session.expired') {
    const { booking_id: bookingId, pass_id: passId } = event.data.object.metadata ?? {};
    if (bookingId) {
      const freed = await expireBooking(db, bookingId);
      await notifyWaitlist(db, freed);
    }
    if (passId) await expirePassPurchase(db, passId);
  }
  return Response.json({ received: true });
}
