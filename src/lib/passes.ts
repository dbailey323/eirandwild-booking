// Passes: class passes, term passes and PT memberships. A client buys (or is given) a
// pass, then books classes with it instead of paying each time. Booking with a pass uses
// one credit (unless the pass is unlimited); cancelling in time puts the credit back.

import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { bookings, classTypes, customerPasses, customers, passTypeClasses, passTypes, registrations, sessions } from '@/db/schema';
import { BookingError, assertNotAlreadyBooked, takenCounts, upsertCustomer, type Booking, type CustomerInput, type Db, type RefundFn } from './booking';
import { addLondonDays, londonDateKey, londonToUtc } from './time';

export type PassType = typeof passTypes.$inferSelect;
export type CustomerPass = typeof customerPasses.$inferSelect;
export type PassTypeWithClasses = PassType & { classTypeIds: number[] };

// ---------------------------------------------------------------- pass types

export type PassTypeInput = {
  name: string;
  description?: string;
  pricePence: number;
  credits: number | null;
  validity: 'days' | 'dates';
  validityDays?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  onSale?: boolean;
  classTypeIds: number[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkPassType(input: PassTypeInput) {
  if (!input.name.trim()) throw new BookingError('invalid', 'Enter a name for the pass.');
  if (!Number.isInteger(input.pricePence) || input.pricePence < 0) throw new BookingError('invalid', 'Enter a valid price.');
  if (input.credits !== null && (!Number.isInteger(input.credits) || input.credits < 1)) throw new BookingError('invalid', 'Number of classes must be at least 1, or leave it blank for unlimited.');
  if (!input.classTypeIds.length) throw new BookingError('invalid', 'Choose at least one class the pass can be used for.');
  if (input.validity === 'days') {
    if (!input.validityDays || input.validityDays < 1) throw new BookingError('invalid', 'Enter how many days the pass lasts.');
  } else {
    if (!input.validFrom || !input.validUntil || !DATE.test(input.validFrom) || !DATE.test(input.validUntil)) throw new BookingError('invalid', 'Enter the first and last dates the pass can be used.');
    if (input.validUntil < input.validFrom) throw new BookingError('invalid', 'The last date must be after the first date.');
  }
}

export async function createPassType(db: Db, input: PassTypeInput): Promise<PassType> {
  checkPassType(input);
  return db.transaction(async (tx) => {
    const [type] = await tx
      .insert(passTypes)
      .values({
        name: input.name.trim(),
        description: (input.description ?? '').trim(),
        pricePence: input.pricePence,
        credits: input.credits,
        validity: input.validity,
        validityDays: input.validity === 'days' ? input.validityDays! : null,
        validFrom: input.validity === 'dates' ? input.validFrom! : null,
        validUntil: input.validity === 'dates' ? input.validUntil! : null,
        onSale: input.onSale ?? true,
      })
      .returning();
    await tx.insert(passTypeClasses).values(input.classTypeIds.map((classTypeId) => ({ passTypeId: type.id, classTypeId })));
    return type;
  });
}

export async function setPassTypeOnSale(db: Db, id: number, onSale: boolean) {
  await db.update(passTypes).set({ onSale }).where(eq(passTypes.id, id));
}

export async function listPassTypes(db: Db, opts: { onSaleOnly?: boolean; now?: Date } = {}): Promise<PassTypeWithClasses[]> {
  const now = opts.now ?? new Date();
  const types = await db
    .select()
    .from(passTypes)
    .where(opts.onSaleOnly ? eq(passTypes.onSale, true) : undefined)
    .orderBy(asc(passTypes.pricePence), asc(passTypes.id));
  const links = types.length ? await db.select().from(passTypeClasses).where(inArray(passTypeClasses.passTypeId, types.map((t) => t.id))) : [];
  const today = londonDateKey(now);
  return types
    .map((t) => ({ ...t, classTypeIds: links.filter((l) => l.passTypeId === t.id).map((l) => l.classTypeId) }))
    // A term pass stops being sold once its last date has passed
    .filter((t) => !opts.onSaleOnly || t.validity !== 'dates' || (t.validUntil ?? '') >= today);
}

export async function getPassType(db: Db, id: number): Promise<PassTypeWithClasses | null> {
  const [type] = await db.select().from(passTypes).where(eq(passTypes.id, id));
  if (!type) return null;
  const links = await db.select().from(passTypeClasses).where(eq(passTypeClasses.passTypeId, id));
  return { ...type, classTypeIds: links.map((l) => l.classTypeId) };
}

// The window a newly issued pass can be used in
export function passWindow(type: PassType, now: Date): { startsAt: Date; expiresAt: Date } {
  if (type.validity === 'dates') {
    return {
      startsAt: londonToUtc(type.validFrom!, '00:00'),
      expiresAt: londonToUtc(londonDateKey(addLondonDays(londonToUtc(type.validUntil!, '12:00'), 1)), '00:00'),
    };
  }
  // Valid until midnight at the end of the last day
  const lastDay = londonDateKey(addLondonDays(now, type.validityDays ?? 0));
  return { startsAt: now, expiresAt: londonToUtc(londonDateKey(addLondonDays(londonToUtc(lastDay, '12:00'), 1)), '00:00') };
}

// ---------------------------------------------------------------- issuing passes

function newPassValues(customerId: number, type: PassType) {
  return { id: randomUUID(), customerId, passTypeId: type.id, creditsTotal: type.credits };
}

// A client buying a pass on the site. Free passes are active straight away; paid ones
// wait for the Stripe webhook.
export async function createPassPurchase(db: Db, input: { passTypeId: number; customer: CustomerInput; now?: Date }): Promise<CustomerPass> {
  const now = input.now ?? new Date();
  const type = (await listPassTypes(db, { onSaleOnly: true, now })).find((t) => t.id === input.passTypeId);
  if (!type) throw new BookingError('unavailable', 'This pass is no longer available.');
  const customer = await upsertCustomer(db, input.customer);
  const free = type.pricePence === 0;
  const [pass] = await db
    .insert(customerPasses)
    .values({
      ...newPassValues(customer.id, type),
      amountPence: type.pricePence,
      status: free ? 'active' : 'pending',
      paymentMethod: free ? 'free' : 'stripe',
      ...(free ? { ...passWindow(type, now), activatedAt: now } : {}),
    })
    .returning();
  return pass;
}

// Lara gives someone a pass: a prize, a pass paid in cash, or a PT membership
export async function grantPass(
  db: Db,
  input: { passTypeId: number; customerId: number; method: 'free' | 'cash' | 'manual'; amountPence?: number; notes?: string; now?: Date },
): Promise<CustomerPass> {
  const now = input.now ?? new Date();
  const [type] = await db.select().from(passTypes).where(eq(passTypes.id, input.passTypeId));
  if (!type) throw new BookingError('not_found', 'Choose a pass');
  const [pass] = await db
    .insert(customerPasses)
    .values({
      ...newPassValues(input.customerId, type),
      amountPence: input.amountPence ?? 0,
      paymentMethod: input.method,
      status: 'active',
      notes: input.notes ?? '',
      activatedAt: now,
      ...passWindow(type, now),
    })
    .returning();
  return pass;
}

export async function setPassCheckoutId(db: Db, passId: string, checkoutId: string) {
  await db.update(customerPasses).set({ stripeCheckoutId: checkoutId }).where(eq(customerPasses.id, passId));
}

// Called from the Stripe webhook once a pass is paid for. Safe to call twice.
export async function activatePass(db: Db, passId: string, opts: { paymentIntentId?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [pass] = await db.select().from(customerPasses).where(eq(customerPasses.id, passId));
  if (!pass) throw new BookingError('not_found', 'Pass not found');
  if (pass.status === 'active' || pass.status === 'cancelled') return { pass, changed: false };
  const [type] = await db.select().from(passTypes).where(eq(passTypes.id, pass.passTypeId));
  const [updated] = await db
    .update(customerPasses)
    .set({ status: 'active', activatedAt: now, ...passWindow(type, now), stripePaymentIntentId: opts.paymentIntentId ?? pass.stripePaymentIntentId })
    .where(eq(customerPasses.id, passId))
    .returning();
  return { pass: updated, changed: true };
}

export async function expirePassPurchase(db: Db, passId: string) {
  await db.update(customerPasses).set({ status: 'expired' }).where(and(eq(customerPasses.id, passId), eq(customerPasses.status, 'pending')));
}

// ---------------------------------------------------------------- reading passes

export type PassDetail = {
  pass: CustomerPass;
  type: PassType;
  classTypeIds: number[];
  creditsLeft: number | null; // null = unlimited
  usable: boolean; // active, not run out, not past its end date
  state: 'pending' | 'active' | 'not_started' | 'used_up' | 'ended' | 'cancelled' | 'expired';
};

function describePass(pass: CustomerPass, type: PassType, classTypeIds: number[], now: Date): PassDetail {
  const creditsLeft = pass.creditsTotal === null ? null : Math.max(pass.creditsTotal - pass.creditsUsed, 0);
  let state: PassDetail['state'] = pass.status as PassDetail['state'];
  if (pass.status === 'active') {
    if (pass.expiresAt && pass.expiresAt <= now) state = 'ended';
    else if (creditsLeft === 0) state = 'used_up';
    else if (pass.startsAt && pass.startsAt > now) state = 'not_started';
  }
  // A term pass bought before term starts can already be used to book classes in term
  return { pass, type, classTypeIds, creditsLeft, usable: state === 'active' || state === 'not_started', state };
}

export async function customerPassList(db: Db, customerId: number, now = new Date()): Promise<PassDetail[]> {
  const rows = await db
    .select({ pass: customerPasses, type: passTypes })
    .from(customerPasses)
    .innerJoin(passTypes, eq(passTypes.id, customerPasses.passTypeId))
    .where(and(eq(customerPasses.customerId, customerId), inArray(customerPasses.status, ['active', 'cancelled'])))
    .orderBy(desc(customerPasses.createdAt));
  const typeIds = [...new Set(rows.map((r) => r.type.id))];
  const links = typeIds.length ? await db.select().from(passTypeClasses).where(inArray(passTypeClasses.passTypeId, typeIds)) : [];
  return rows.map((r) => describePass(r.pass, r.type, links.filter((l) => l.passTypeId === r.type.id).map((l) => l.classTypeId), now));
}

export async function getPassDetail(db: Db, passId: string, now = new Date()): Promise<(PassDetail & { customer: typeof customers.$inferSelect }) | null> {
  const [row] = await db
    .select({ pass: customerPasses, type: passTypes, customer: customers })
    .from(customerPasses)
    .innerJoin(passTypes, eq(passTypes.id, customerPasses.passTypeId))
    .innerJoin(customers, eq(customers.id, customerPasses.customerId))
    .where(eq(customerPasses.id, passId));
  if (!row) return null;
  const links = await db.select().from(passTypeClasses).where(eq(passTypeClasses.passTypeId, row.type.id));
  return { ...describePass(row.pass, row.type, links.map((l) => l.classTypeId), now), customer: row.customer };
}

// Passes that could pay for this session, soonest-ending first
export async function passesForSession(db: Db, customerId: number, session: typeof sessions.$inferSelect, now = new Date()): Promise<PassDetail[]> {
  const all = await customerPassList(db, customerId, now);
  return all
    .filter((p) => p.usable && p.classTypeIds.includes(session.classTypeId))
    .filter((p) => (!p.pass.startsAt || p.pass.startsAt <= session.startsAt) && (!p.pass.expiresAt || session.startsAt < p.pass.expiresAt))
    .sort((a, b) => (a.pass.expiresAt?.getTime() ?? Infinity) - (b.pass.expiresAt?.getTime() ?? Infinity));
}

// ---------------------------------------------------------------- booking with a pass

export async function bookWithPass(
  db: Db,
  input: { sessionId: number; customerId: number; passId?: string; byAdmin?: boolean; now?: Date },
): Promise<Booking> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, input.sessionId)).for('update');
    if (!session || session.status !== 'scheduled') throw new BookingError('unavailable', 'This class is no longer available.');
    if (!input.byAdmin && session.startsAt <= now) throw new BookingError('started', 'This class has already started.');
    if (session.pricePence === null) throw new BookingError('course_only', 'This class can only be booked as part of its course.');
    const taken = (await takenCounts(tx, [session.id], now)).get(session.id) ?? 0;
    if (taken >= session.capacity) throw new BookingError('full', 'Sorry, this class is now fully booked.');
    await assertNotAlreadyBooked(tx, input.customerId, [session.id], now);

    const options = await passesForSession(tx, input.customerId, session, now);
    const chosen = input.passId ? options.find((p) => p.pass.id === input.passId) : options[0];
    if (!chosen) throw new BookingError('no_pass', "There's no pass that covers this class.");
    // Lock the pass so two bookings can't use its last credit at once
    const [pass] = await tx.select().from(customerPasses).where(eq(customerPasses.id, chosen.pass.id)).for('update');
    if (pass.creditsTotal !== null && pass.creditsUsed >= pass.creditsTotal) throw new BookingError('no_credits', 'Your pass has no classes left.');
    await tx.update(customerPasses).set({ creditsUsed: pass.creditsUsed + 1 }).where(eq(customerPasses.id, pass.id));

    const [booking] = await tx
      .insert(bookings)
      .values({
        id: randomUUID(),
        customerId: input.customerId,
        kind: 'session',
        sessionId: session.id,
        amountPence: 0,
        status: 'confirmed',
        paymentMethod: 'pass',
        passId: pass.id,
        manageToken: randomBytes(24).toString('base64url'),
        confirmedAt: now,
      })
      .returning();
    await tx.insert(registrations).values({ bookingId: booking.id, sessionId: session.id });
    return booking;
  });
}

// ---------------------------------------------------------------- Lara's changes

export async function adjustPass(db: Db, passId: string, input: { creditsTotal?: number | null; expiresOn?: string | null; notes?: string }) {
  const set: Partial<CustomerPass> = {};
  if (input.creditsTotal !== undefined) {
    if (input.creditsTotal !== null && (!Number.isInteger(input.creditsTotal) || input.creditsTotal < 0)) throw new BookingError('invalid', 'Enter a valid number of classes.');
    set.creditsTotal = input.creditsTotal;
  }
  if (input.expiresOn) {
    if (!DATE.test(input.expiresOn)) throw new BookingError('invalid', 'Enter a valid date.');
    set.expiresAt = londonToUtc(londonDateKey(addLondonDays(londonToUtc(input.expiresOn, '12:00'), 1)), '00:00');
  }
  if (input.notes !== undefined) set.notes = input.notes;
  if (Object.keys(set).length) await db.update(customerPasses).set(set).where(eq(customerPasses.id, passId));
}

// Cancels a pass so it can't be used again, optionally refunding some or all of a card payment.
// Classes already booked with it stay booked.
export async function cancelPass(db: Db, passId: string, opts: { refundPence?: number; refund: RefundFn; now?: Date }) {
  const now = opts.now ?? new Date();
  const [pass] = await db.select().from(customerPasses).where(eq(customerPasses.id, passId));
  if (!pass) throw new BookingError('not_found', 'Pass not found');
  if (pass.status !== 'active') throw new BookingError('already_cancelled', 'This pass is not active.');
  const refundPence = Math.min(Math.max(opts.refundPence ?? 0, 0), pass.amountPence - pass.refundedPence);
  if (refundPence > 0) {
    if (pass.paymentMethod !== 'stripe' || !pass.stripePaymentIntentId) throw new BookingError('no_payment', 'No card payment found to refund.');
    await opts.refund(pass.stripePaymentIntentId, refundPence);
  }
  await db
    .update(customerPasses)
    .set({ status: 'cancelled', cancelledAt: now, refundedPence: pass.refundedPence + refundPence })
    .where(eq(customerPasses.id, passId));
  return { refundedPence: refundPence };
}

// ---------------------------------------------------------------- clients

export async function searchCustomers(db: Db, query: string, limit = 50) {
  const q = query.trim();
  return db
    .select()
    .from(customers)
    .where(q ? or(ilike(customers.name, `%${q}%`), ilike(customers.email, `%${q}%`), ilike(customers.phone, `%${q}%`)) : undefined)
    .orderBy(q ? asc(customers.name) : desc(customers.createdAt))
    .limit(limit);
}

// A client's bookings, newest class first, with the first session of each
export async function customerBookings(db: Db, customerId: number) {
  const rows = await db
    .select({ booking: bookings, session: sessions, classType: classTypes, registration: registrations })
    .from(bookings)
    .innerJoin(registrations, eq(registrations.bookingId, bookings.id))
    .innerJoin(sessions, eq(sessions.id, registrations.sessionId))
    .innerJoin(classTypes, eq(classTypes.id, sessions.classTypeId))
    .where(and(eq(bookings.customerId, customerId), inArray(bookings.status, ['confirmed', 'cancelled'])))
    .orderBy(desc(sessions.startsAt));
  return rows;
}
