'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { BookingError } from '@/lib/errors';
import { formatPence, poundsToPence } from '@/lib/money';
import { passEndText } from '@/lib/notify';
import { createVoucherCheckout } from '@/lib/stripe';
import { checkVoucher, createVoucherPurchase, expireVoucherPurchase, setVoucherCheckoutId, type GiftVoucher } from '@/lib/vouchers';
import type { FormState } from '@/app/actions';

const str = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

export async function buyVoucher(_prev: FormState, form: FormData): Promise<FormState> {
  if (str(form, 'website')) return { error: 'Something went wrong. Please try again.' };
  if (form.get('agree') !== 'on') return { error: 'Please tick to agree to the gift voucher terms.' };
  const choice = str(form, 'amount');
  const amountPence = choice === 'other' ? poundsToPence(str(form, 'other') || '0') : Number(choice);
  const db = getDb();
  let voucher: GiftVoucher;
  try {
    voucher = await createVoucherPurchase(db, {
      amountPence,
      buyerName: str(form, 'name'),
      buyerEmail: str(form, 'email'),
      recipientName: str(form, 'recipientName'),
      recipientEmail: form.get('sendToRecipient') === 'on' ? str(form, 'recipientEmail') : '',
      message: str(form, 'message'),
    });
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    if (error instanceof Error && /valid price/.test(error.message)) return { error: 'Please enter a valid amount.' };
    throw error;
  }
  let url: string;
  try {
    const checkout = await createVoucherCheckout(voucher);
    await setVoucherCheckoutId(db, voucher.id, checkout.id);
    url = checkout.url;
  } catch (error) {
    console.error('Could not start Stripe checkout for a voucher', error);
    await expireVoucherPurchase(db, voucher.id);
    return { error: "Sorry, we couldn't start the payment. Please try again in a moment." };
  }
  redirect(url);
}

export async function voucherBalance(_prev: FormState, form: FormData): Promise<FormState> {
  const code = str(form, 'code');
  if (!code) return { error: 'Enter your voucher code.' };
  try {
    const v = await checkVoucher(getDb(), code);
    const until = passEndText(v.expiresAt, true);
    return { ok: `${v.code} has ${formatPence(v.balancePence)} left to spend${until ? `, until ${until}` : ''}.` };
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    throw error;
  }
}
