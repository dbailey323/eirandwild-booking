import Stripe from 'stripe';
import type { BookingDescription } from './booking';
import type { CustomerPass, PassType } from './passes';
import type { GiftVoucher } from './vouchers';
import { CHECKOUT_MINUTES } from './policy';
import { formatDayShort, formatTime } from './time';

let client: Stripe | undefined;

export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    client = new Stripe(key);
  }
  return client;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

// Sends the customer to Stripe's hosted checkout. Card details never touch our server.
export async function createCheckout(desc: BookingDescription, cancelPath: string): Promise<{ id: string; url: string }> {
  const { booking, customer, sessions, title } = desc;
  const dates = sessions.map((s) => `${formatDayShort(s.session.startsAt)} ${formatTime(s.session.startsAt)}`);
  const checkout = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: customer.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: booking.amountPence - booking.voucherPence,
          product_data: {
            name: title,
            description: dates.length > 3 ? `${dates.length} sessions from ${dates[0]}` : dates.join(', '),
          },
        },
      },
    ],
    metadata: { booking_id: booking.id },
    payment_intent_data: { metadata: { booking_id: booking.id } },
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
    success_url: `${appUrl()}/booking/${booking.manageToken}?paid=1`,
    cancel_url: `${appUrl()}${cancelPath}`,
  });
  if (!checkout.url) throw new Error('Stripe did not return a checkout link');
  return { id: checkout.id, url: checkout.url };
}

export async function refundPayment(paymentIntentId: string, amountPence: number): Promise<void> {
  await stripe().refunds.create({ payment_intent: paymentIntentId, amount: amountPence });
}

// Checkout for buying a pass. The webhook activates it once paid.
export async function createPassCheckout(
  pass: CustomerPass,
  type: PassType,
  email: string,
  summary: string,
  cancelPath: string,
): Promise<{ id: string; url: string }> {
  const checkout = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    line_items: [
      {
        quantity: 1,
        price_data: { currency: 'gbp', unit_amount: pass.amountPence - pass.voucherPence, product_data: { name: type.name, description: summary } },
      },
    ],
    metadata: { pass_id: pass.id },
    payment_intent_data: { metadata: { pass_id: pass.id } },
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
    success_url: `${appUrl()}/passes/done/${pass.id}`,
    cancel_url: `${appUrl()}${cancelPath}`,
  });
  if (!checkout.url) throw new Error('Stripe did not return a checkout link');
  return { id: checkout.id, url: checkout.url };
}

// Checkout for buying a gift voucher. The webhook activates it and emails the code.
export async function createVoucherCheckout(voucher: GiftVoucher): Promise<{ id: string; url: string }> {
  const checkout = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: voucher.buyerEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: voucher.amountPence,
          product_data: { name: 'Eir & Wild gift voucher', description: voucher.recipientName ? `For ${voucher.recipientName}` : undefined },
        },
      },
    ],
    metadata: { voucher_id: voucher.id },
    payment_intent_data: { metadata: { voucher_id: voucher.id } },
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
    success_url: `${appUrl()}/gift/done/${voucher.id}`,
    cancel_url: `${appUrl()}/gift`,
  });
  if (!checkout.url) throw new Error('Stripe did not return a checkout link');
  return { id: checkout.id, url: checkout.url };
}
