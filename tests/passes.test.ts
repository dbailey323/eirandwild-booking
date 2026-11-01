import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { classTypes } from '@/db/schema';
import { BookingError, cancelBooking, cancelSession, createSessions, upsertCustomer } from '@/lib/booking';
import {
  activatePass,
  adjustPass,
  bookWithPass,
  cancelPass,
  createPassPurchase,
  createPassType,
  customerPassList,
  expirePassPurchase,
  grantPass,
  listPassTypes,
  passWindow,
  passesForSession,
  searchCustomers,
} from '@/lib/passes';
import { londonToUtc } from '@/lib/time';
import { alice, bea, seedBasics, testDb } from './helpers';

const NOW = londonToUtc('2026-11-01', '12:00');
const noRefund = vi.fn(async () => {});

async function setup() {
  const db = await testDb();
  const base = await seedBasics(db);
  const [double] = await db
    .insert(classTypes)
    .values({ slug: 'monday-double', name: 'Monday Double', group: 'womanhood', defaultPricePence: 1000 })
    .returning();
  const dance = await createSessions(db, {
    classTypeId: base.dance.id, locationId: base.library.id, date: '2026-11-02', time: '18:30',
    durationMinutes: 30, weeks: 4, capacity: 2, pricePence: 700,
  });
  const doubles = await createSessions(db, {
    classTypeId: double.id, locationId: base.library.id, date: '2026-11-02', time: '19:00',
    durationMinutes: 60, weeks: 1, capacity: 10, pricePence: 1000,
  });
  const fiveClass = await createPassType(db, {
    name: 'Womanhood 5-class pass', pricePence: 3000, credits: 5, validity: 'days', validityDays: 90, classTypeIds: [base.dance.id],
  });
  const unlimited = await createPassType(db, {
    name: 'PT membership', pricePence: 9500, credits: null, validity: 'days', validityDays: 28, classTypeIds: [base.dance.id], onSale: false,
  });
  const customer = await upsertCustomer(db, alice);
  return { db, ...base, double, dance, doubles, fiveClass, unlimited, customer };
}

describe('pass types', () => {
  it('checks the details make sense', async () => {
    const { db, dance } = await setup();
    await expect(createPassType(db, { name: 'x', pricePence: 100, credits: 0, validity: 'days', validityDays: 10, classTypeIds: [dance[0].classTypeId] })).rejects.toThrow(BookingError);
    await expect(createPassType(db, { name: 'x', pricePence: 100, credits: 5, validity: 'dates', validFrom: '2026-12-01', validUntil: '2026-11-01', classTypeIds: [dance[0].classTypeId] })).rejects.toThrow(/after/);
    await expect(createPassType(db, { name: 'x', pricePence: 100, credits: 5, validity: 'days', validityDays: 10, classTypeIds: [] })).rejects.toThrow(/at least one/);
  });

  it('lists only passes on sale, and stops selling term passes once term is over', async () => {
    const { db, dance } = await setup();
    await createPassType(db, { name: 'Old term', pricePence: 3200, credits: 4, validity: 'dates', validFrom: '2026-09-01', validUntil: '2026-10-20', classTypeIds: [dance[0].classTypeId] });
    const names = (await listPassTypes(db, { onSaleOnly: true, now: NOW })).map((t) => t.name);
    expect(names).toEqual(['Womanhood 5-class pass']);
    expect((await listPassTypes(db)).length).toBe(3);
  });

  it('works out when a pass ends', async () => {
    const { fiveClass } = await setup();
    const w = passWindow(fiveClass, NOW);
    expect(w.startsAt).toEqual(NOW);
    // 90 days from 1 November, to midnight at the end of 30 January
    expect(w.expiresAt.toISOString()).toBe('2027-01-31T00:00:00.000Z');
  });
});

describe('buying a pass', () => {
  it('waits for payment, then activates once (webhook can repeat)', async () => {
    const { db, fiveClass } = await setup();
    const pass = await createPassPurchase(db, { passTypeId: fiveClass.id, customer: bea, now: NOW });
    expect(pass.status).toBe('pending');
    expect(pass.creditsTotal).toBe(5);
    const first = await activatePass(db, pass.id, { paymentIntentId: 'pi_1', now: NOW });
    expect(first.changed).toBe(true);
    expect(first.pass.expiresAt).not.toBeNull();
    expect((await activatePass(db, pass.id, { now: NOW })).changed).toBe(false);
  });

  it('cannot buy a pass that is not on sale', async () => {
    const { db, unlimited } = await setup();
    await expect(createPassPurchase(db, { passTypeId: unlimited.id, customer: bea, now: NOW })).rejects.toThrow(/no longer available/);
  });

  it('an unpaid checkout leaves no usable pass', async () => {
    const { db, fiveClass, dance } = await setup();
    const pass = await createPassPurchase(db, { passTypeId: fiveClass.id, customer: bea, now: NOW });
    await expirePassPurchase(db, pass.id);
    const customer = await upsertCustomer(db, bea);
    expect(await passesForSession(db, customer.id, dance[0], NOW)).toEqual([]);
  });
});

describe('booking with a pass', () => {
  it('uses a credit, and only for the classes the pass covers', async () => {
    const { db, fiveClass, customer, dance, doubles } = await setup();
    const pass = await grantPass(db, { passTypeId: fiveClass.id, customerId: customer.id, method: 'free', now: NOW });
    const booking = await bookWithPass(db, { sessionId: dance[0].id, customerId: customer.id, now: NOW });
    expect(booking.status).toBe('confirmed');
    expect(booking.paymentMethod).toBe('pass');
    expect(booking.passId).toBe(pass.id);
    const [detail] = await customerPassList(db, customer.id, NOW);
    expect(detail.creditsLeft).toBe(4);
    // Monday Double isn't on the pass
    await expect(bookWithPass(db, { sessionId: doubles[0].id, customerId: customer.id, now: NOW })).rejects.toThrow(/no pass/);
  });

  it('stops when the credits run out', async () => {
    const { db, fiveClass, customer, dance } = await setup();
    const pass = await grantPass(db, { passTypeId: fiveClass.id, customerId: customer.id, method: 'free', now: NOW });
    await adjustPass(db, pass.id, { creditsTotal: 1 });
    await bookWithPass(db, { sessionId: dance[0].id, customerId: customer.id, now: NOW });
    await expect(bookWithPass(db, { sessionId: dance[1].id, customerId: customer.id, now: NOW })).rejects.toThrow(/no pass/);
    const [detail] = await customerPassList(db, customer.id, NOW);
    expect(detail.state).toBe('used_up');
  });

  it('cannot be used for a class after the pass ends', async () => {
    const { db, fiveClass, customer, dance } = await setup();
    const pass = await grantPass(db, { passTypeId: fiveClass.id, customerId: customer.id, method: 'free', now: NOW });
    await adjustPass(db, pass.id, { expiresOn: '2026-11-05' });
    expect((await passesForSession(db, customer.id, dance[0], NOW)).length).toBe(1); // 2 Nov
    expect((await passesForSession(db, customer.id, dance[1], NOW)).length).toBe(0); // 9 Nov
  });

  it('a term pass bought early covers classes in term only', async () => {
    const { db, dance, customer } = await setup();
    const term = await createPassType(db, { name: 'Term', pricePence: 3200, credits: 4, validity: 'dates', validFrom: '2026-11-09', validUntil: '2026-11-16', classTypeIds: [dance[0].classTypeId] });
    await grantPass(db, { passTypeId: term.id, customerId: customer.id, method: 'cash', amountPence: 3200, now: NOW });
    const covered = [];
    for (const s of dance) covered.push((await passesForSession(db, customer.id, s, NOW)).length);
    expect(covered).toEqual([0, 1, 1, 0]); // 2, 9, 16, 23 Nov
  });

  it('unlimited passes never run out but still allow one place per class', async () => {
    const { db, unlimited, customer, dance } = await setup();
    await grantPass(db, { passTypeId: unlimited.id, customerId: customer.id, method: 'manual', amountPence: 9500, now: NOW });
    for (const s of dance) await bookWithPass(db, { sessionId: s.id, customerId: customer.id, now: NOW });
    const [detail] = await customerPassList(db, customer.id, NOW);
    expect(detail.creditsLeft).toBeNull();
    expect(detail.pass.creditsUsed).toBe(4);
    await expect(bookWithPass(db, { sessionId: dance[0].id, customerId: customer.id, now: NOW })).rejects.toThrow(/already booked/);
  });

  it('respects class capacity', async () => {
    const { db, fiveClass, dance } = await setup();
    const ids = [];
    for (const c of [alice, bea, { email: 'cat@example.com', name: 'Cat' }]) {
      const customer = await upsertCustomer(db, c);
      await grantPass(db, { passTypeId: fiveClass.id, customerId: customer.id, method: 'free', now: NOW });
      ids.push(customer.id);
    }
    await bookWithPass(db, { sessionId: dance[0].id, customerId: ids[0], now: NOW });
    await bookWithPass(db, { sessionId: dance[0].id, customerId: ids[1], now: NOW });
    await expect(bookWithPass(db, { sessionId: dance[0].id, customerId: ids[2], now: NOW })).rejects.toThrow(/fully booked/);
  });

  it('uses the pass that ends soonest', async () => {
    const { db, fiveClass, unlimited, customer, dance } = await setup();
    await grantPass(db, { passTypeId: fiveClass.id, customerId: customer.id, method: 'free', now: NOW });
    const pt = await grantPass(db, { passTypeId: unlimited.id, customerId: customer.id, method: 'free', now: NOW });
    const booking = await bookWithPass(db, { sessionId: dance[0].id, customerId: customer.id, now: NOW });
    expect(booking.passId).toBe(pt.id);
  });
});

describe('cancelling pass bookings', () => {
  it('puts the class back on the pass with 4 hours notice', async () => {
    const { db, fiveClass, customer, dance } = await setup();
    await grantPass(db, { passTypeId: fiveClass.id, customerId: customer.id, method: 'free', now: NOW });
    const booking = await bookWithPass(db, { sessionId: dance[0].id, customerId: customer.id, now: NOW });
    const result = await cancelBooking(db, booking.id, { refund: noRefund, now: NOW });
    expect(result.creditReturned).toBe(true);
    expect(result.refundedPence).toBe(0);
    expect(noRefund).not.toHaveBeenCalled();
    expect((await customerPassList(db, customer.id, NOW))[0].creditsLeft).toBe(5);
  });

  it('keeps the credit used when cancelled late', async () => {
    const { db, fiveClass, customer, dance } = await setup();
    await grantPass(db, { passTypeId: fiveClass.id, customerId: customer.id, method: 'free', now: NOW });
    const booking = await bookWithPass(db, { sessionId: dance[0].id, customerId: customer.id, now: NOW });
    const late = londonToUtc('2026-11-02', '16:00'); // 2.5 hours before
    const result = await cancelBooking(db, booking.id, { refund: noRefund, now: late });
    expect(result.creditReturned).toBe(false);
    expect((await customerPassList(db, customer.id, late))[0].creditsLeft).toBe(4);
  });

  it('gives the credit back when Lara cancels the class', async () => {
    const { db, fiveClass, customer, dance } = await setup();
    await grantPass(db, { passTypeId: fiveClass.id, customerId: customer.id, method: 'free', now: NOW });
    await bookWithPass(db, { sessionId: dance[0].id, customerId: customer.id, now: NOW });
    const late = londonToUtc('2026-11-02', '17:00');
    await cancelSession(db, dance[0].id, { refund: noRefund, now: late });
    expect((await customerPassList(db, customer.id, late))[0].creditsLeft).toBe(5);
  });
});

describe('cancelling a pass', () => {
  it('refunds part of a card payment and stops the pass being used', async () => {
    const { db, fiveClass, customer, dance } = await setup();
    const pending = await createPassPurchase(db, { passTypeId: fiveClass.id, customer: alice, now: NOW });
    await activatePass(db, pending.id, { paymentIntentId: 'pi_9', now: NOW });
    const refund = vi.fn(async () => {});
    const result = await cancelPass(db, pending.id, { refundPence: 1800, refund, now: NOW });
    expect(result.refundedPence).toBe(1800);
    expect(refund).toHaveBeenCalledWith('pi_9', 1800);
    expect(await passesForSession(db, customer.id, dance[0], NOW)).toEqual([]);
  });
});

describe('clients', () => {
  it('finds clients by name, email or phone', async () => {
    const { db } = await setup();
    await upsertCustomer(db, bea);
    expect((await searchCustomers(db, 'ali')).map((c) => c.name)).toEqual(['Alice']);
    expect((await searchCustomers(db, '000001')).map((c) => c.name)).toEqual(['Alice']);
    expect((await searchCustomers(db, '')).length).toBe(2);
    const [row] = await db.select().from(classTypes).where(eq(classTypes.slug, 'monday-double'));
    expect(row).toBeTruthy();
  });
});
