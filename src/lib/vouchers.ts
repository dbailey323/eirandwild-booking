// Gift vouchers: a money balance with a code. Someone buys one (or Lara issues one),
// and the recipient enters the code when booking a class, a course or a pass. A voucher
// can pay for all of a booking or part of it, with the rest paid by card.

import { randomInt, randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '@/db/schema';
import { giftVouchers, voucherRedemptions } from '@/db/schema';
import { BookingError } from './errors';
import { VOUCHER_MAX_PENCE, VOUCHER_MIN_PENCE, VOUCHER_MONTHS } from './policy';
import { addLondonDays, londonDateKey, londonToUtc } from './time';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<PgQueryResultHKT, typeof schema, any>;
export type GiftVoucher = typeof giftVouchers.$inferSelect;
export type VoucherTarget = { bookingId: string } | { passId: string };
type RefundFn = (paymentIntentId: string, amountPence: number) => Promise<void>;

// ---------------------------------------------------------------- codes

// No 0/O, 1/I/L, so codes are easy to read out and type
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode(): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `EW-${part()}-${part()}`;
}

// Accepts "ew 7kq2 m9xd", "EW7KQ2M9XD" or "7KQ2-M9XD"
export function normaliseCode(input: string): string {
  let raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length === 10 && raw.startsWith('EW')) raw = raw.slice(2);
  if (raw.length !== 8) return input.trim().toUpperCase();
  return `EW-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Midnight at the end of the day, VOUCHER_MONTHS from now
export function voucherExpiry(now: Date, months = VOUCHER_MONTHS): Date {
  const [y, m, d] = londonDateKey(now).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
  return londonToUtc(londonDateKey(addLondonDays(londonToUtc(day, '12:00'), 1)), '00:00');
}

// ---------------------------------------------------------------- issuing

export type VoucherInput = {
  amountPence: number;
  buyerName: string;
  buyerEmail: string;
  recipientName?: string;
  recipientEmail?: string;
  message?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkInput(input: VoucherInput, admin = false) {
  if (!Number.isInteger(input.amountPence) || input.amountPence < (admin ? 100 : VOUCHER_MIN_PENCE) || input.amountPence > VOUCHER_MAX_PENCE) {
    throw new BookingError('invalid', `Choose an amount between £${VOUCHER_MIN_PENCE / 100} and £${VOUCHER_MAX_PENCE / 100}.`);
  }
  if (!input.buyerName.trim()) throw new BookingError('invalid_name', 'Please enter your name.');
  if (!EMAIL.test(input.buyerEmail.trim())) throw new BookingError('invalid_email', 'Please enter a valid email address.');
  if (input.recipientEmail?.trim() && !EMAIL.test(input.recipientEmail.trim())) throw new BookingError('invalid_email', "Please check the recipient's email address.");
  if ((input.message ?? '').length > 500) throw new BookingError('invalid', 'Please keep the message under 500 characters.');
}

function voucherValues(input: VoucherInput) {
  return {
    id: randomUUID(),
    code: generateCode(),
    amountPence: input.amountPence,
    balancePence: input.amountPence,
    buyerName: input.buyerName.trim(),
    buyerEmail: input.buyerEmail.trim().toLowerCase(),
    recipientName: (input.recipientName ?? '').trim(),
    recipientEmail: (input.recipientEmail ?? '').trim().toLowerCase(),
    message: (input.message ?? '').trim(),
  };
}

// Someone buying a voucher on the site; the Stripe webhook activates it
export async function createVoucherPurchase(db: Db, input: VoucherInput): Promise<GiftVoucher> {
  checkInput(input);
  const [voucher] = await db.insert(giftVouchers).values({ ...voucherValues(input), status: 'pending' }).returning();
  return voucher;
}

// Lara issues a voucher herself (a prize, a raffle donation, or one paid in cash)
export async function grantVoucher(
  db: Db,
  input: VoucherInput & { method: 'free' | 'cash' | 'manual'; notes?: string; now?: Date },
): Promise<GiftVoucher> {
  checkInput(input, true);
  const now = input.now ?? new Date();
  const [voucher] = await db
    .insert(giftVouchers)
    .values({ ...voucherValues(input), status: 'active', paymentMethod: input.method, notes: input.notes ?? '', activatedAt: now, expiresAt: voucherExpiry(now) })
    .returning();
  return voucher;
}

export async function setVoucherCheckoutId(db: Db, id: string, checkoutId: string) {
  await db.update(giftVouchers).set({ stripeCheckoutId: checkoutId }).where(eq(giftVouchers.id, id));
}

// Called from the Stripe webhook once a voucher is paid for. Safe to call twice.
export async function activateVoucher(db: Db, id: string, opts: { paymentIntentId?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [voucher] = await db.select().from(giftVouchers).where(eq(giftVouchers.id, id));
  if (!voucher) throw new BookingError('not_found', 'Voucher not found');
  if (voucher.status === 'active' || voucher.status === 'cancelled') return { voucher, changed: false };
  const [updated] = await db
    .update(giftVouchers)
    .set({ status: 'active', activatedAt: now, expiresAt: voucherExpiry(now), stripePaymentIntentId: opts.paymentIntentId ?? voucher.stripePaymentIntentId })
    .where(eq(giftVouchers.id, id))
    .returning();
  return { voucher: updated, changed: true };
}

export async function expireVoucherPurchase(db: Db, id: string) {
  await db.update(giftVouchers).set({ status: 'expired' }).where(and(eq(giftVouchers.id, id), eq(giftVouchers.status, 'pending')));
}

// ---------------------------------------------------------------- spending

function usableOrThrow(voucher: GiftVoucher | undefined, now: Date): GiftVoucher {
  if (!voucher || voucher.status === 'pending' || voucher.status === 'expired') throw new BookingError('voucher_unknown', "That gift voucher code isn't recognised. Please check it and try again.");
  if (voucher.status === 'cancelled') throw new BookingError('voucher_cancelled', 'That gift voucher has been cancelled.');
  if (voucher.expiresAt && voucher.expiresAt <= now) throw new BookingError('voucher_expired', 'Sorry, that gift voucher has expired.');
  if (voucher.balancePence <= 0) throw new BookingError('voucher_used', 'That gift voucher has been used up.');
  return voucher;
}

// Looks up a code for the balance checker. Throws a friendly error when it can't be used.
export async function checkVoucher(db: Db, code: string, now = new Date()): Promise<GiftVoucher> {
  const [voucher] = await db.select().from(giftVouchers).where(eq(giftVouchers.code, normaliseCode(code)));
  return usableOrThrow(voucher, now);
}

// Takes up to maxPence off the voucher towards a booking or pass. Returns the amount used.
// Call inside the booking's transaction so a failed booking puts the money back.
export async function applyVoucher(db: Db, code: string, maxPence: number, target: VoucherTarget, now = new Date()): Promise<number> {
  if (maxPence <= 0) return 0;
  const [row] = await db.select().from(giftVouchers).where(eq(giftVouchers.code, normaliseCode(code))).for('update');
  const voucher = usableOrThrow(row, now);
  const use = Math.min(voucher.balancePence, maxPence);
  await db.update(giftVouchers).set({ balancePence: voucher.balancePence - use }).where(eq(giftVouchers.id, voucher.id));
  await db.insert(voucherRedemptions).values({
    voucherId: voucher.id,
    bookingId: 'bookingId' in target ? target.bookingId : null,
    passId: 'passId' in target ? target.passId : null,
    amountPence: use,
  });
  return use;
}

// Puts voucher money back (an unpaid checkout, or a cancellation that's refunded).
// Returns the amount returned. Safe to call twice.
export async function reverseVoucher(db: Db, target: VoucherTarget, now = new Date()): Promise<number> {
  const match = 'bookingId' in target ? eq(voucherRedemptions.bookingId, target.bookingId) : eq(voucherRedemptions.passId, target.passId);
  const rows = await db
    .update(voucherRedemptions)
    .set({ reversedAt: now })
    .where(and(match, isNull(voucherRedemptions.reversedAt)))
    .returning();
  let total = 0;
  for (const r of rows) {
    const [voucher] = await db.select().from(giftVouchers).where(eq(giftVouchers.id, r.voucherId)).for('update');
    await db.update(giftVouchers).set({ balancePence: voucher.balancePence + r.amountPence }).where(eq(giftVouchers.id, voucher.id));
    total += r.amountPence;
  }
  return total;
}

// ---------------------------------------------------------------- Lara's tools

export async function listVouchers(db: Db, query = '', limit = 100) {
  const q = query.trim();
  const code = normaliseCode(q);
  return db
    .select()
    .from(giftVouchers)
    .where(
      q
        ? or(ilike(giftVouchers.code, `%${code}%`), ilike(giftVouchers.buyerName, `%${q}%`), ilike(giftVouchers.buyerEmail, `%${q}%`), ilike(giftVouchers.recipientName, `%${q}%`), ilike(giftVouchers.recipientEmail, `%${q}%`))
        : or(eq(giftVouchers.status, 'active'), eq(giftVouchers.status, 'cancelled')),
    )
    .orderBy(desc(giftVouchers.createdAt))
    .limit(limit);
}

export async function getVoucher(db: Db, id: string) {
  const [voucher] = await db.select().from(giftVouchers).where(eq(giftVouchers.id, id));
  if (!voucher) return null;
  const redemptions = await db.select().from(voucherRedemptions).where(eq(voucherRedemptions.voucherId, id)).orderBy(desc(voucherRedemptions.createdAt));
  return { voucher, redemptions };
}

export async function adjustVoucher(db: Db, id: string, input: { balancePence?: number; expiresOn?: string; notes?: string }) {
  const set: Partial<GiftVoucher> = {};
  if (input.balancePence !== undefined) {
    if (!Number.isInteger(input.balancePence) || input.balancePence < 0) throw new BookingError('invalid', 'Enter a valid balance.');
    set.balancePence = input.balancePence;
  }
  if (input.expiresOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)) throw new BookingError('invalid', 'Enter a valid date.');
    set.expiresAt = londonToUtc(londonDateKey(addLondonDays(londonToUtc(input.expiresOn, '12:00'), 1)), '00:00');
  }
  if (input.notes !== undefined) set.notes = input.notes;
  if (Object.keys(set).length) await db.update(giftVouchers).set(set).where(eq(giftVouchers.id, id));
}

// Stops a voucher being used, optionally refunding some of what was paid for it by card
export async function cancelVoucher(db: Db, id: string, opts: { refundPence?: number; refund: RefundFn; now?: Date }) {
  const now = opts.now ?? new Date();
  const [voucher] = await db.select().from(giftVouchers).where(eq(giftVouchers.id, id));
  if (!voucher) throw new BookingError('not_found', 'Voucher not found');
  if (voucher.status !== 'active') throw new BookingError('already_cancelled', 'This voucher is not active.');
  const refundPence = Math.min(Math.max(opts.refundPence ?? 0, 0), voucher.amountPence);
  if (refundPence > 0) {
    if (voucher.paymentMethod !== 'stripe' || !voucher.stripePaymentIntentId) throw new BookingError('no_payment', 'No card payment found to refund.');
    await opts.refund(voucher.stripePaymentIntentId, refundPence);
  }
  await db.update(giftVouchers).set({ status: 'cancelled', cancelledAt: now, balancePence: 0 }).where(eq(giftVouchers.id, id));
  return { refundedPence: refundPence };
}
