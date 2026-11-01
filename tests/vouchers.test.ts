import { describe, expect, it, vi } from 'vitest';
import { cancelBooking, cancelSession, confirmBooking, createCourse, createCourseBooking, createSessionBooking, createSessions, expireBooking } from '@/lib/booking';
import { cancelPass, createPassPurchase, createPassType, expirePassPurchase } from '@/lib/passes';
import {
  activateVoucher,
  adjustVoucher,
  cancelVoucher,
  checkVoucher,
  createVoucherPurchase,
  expireVoucherPurchase,
  generateCode,
  getVoucher,
  grantVoucher,
  listVouchers,
  normaliseCode,
  voucherExpiry,
} from '@/lib/vouchers';
import { londonToUtc } from '@/lib/time';
import { alice, bea, seedBasics, testDb } from './helpers';

const NOW = londonToUtc('2026-11-01', '12:00');
const refund = vi.fn(async () => {});

async function setup() {
  const db = await testDb();
  const base = await seedBasics(db);
  const dance = await createSessions(db, {
    classTypeId: base.dance.id, locationId: base.library.id, date: '2026-11-02', time: '18:30',
    durationMinutes: 30, weeks: 2, capacity: 5, pricePence: 700,
  });
  const voucher = await grantVoucher(db, { amountPence: 2500, buyerName: 'Gran', buyerEmail: 'gran@example.com', recipientName: 'Alice', method: 'free', now: NOW });
  return { db, ...base, dance, voucher };
}

const balance = async (db: Awaited<ReturnType<typeof setup>>['db'], id: string) => (await getVoucher(db, id))!.voucher.balancePence;

describe('voucher codes', () => {
  it('are easy to type in any format', () => {
    expect(generateCode()).toMatch(/^EW-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normaliseCode('ew 7kq2 m9xd')).toBe('EW-7KQ2-M9XD');
    expect(normaliseCode('7KQ2-M9XD')).toBe('EW-7KQ2-M9XD');
  });

  it('last 12 months, to the end of the day', () => {
    expect(voucherExpiry(NOW).toISOString()).toBe('2027-11-02T00:00:00.000Z');
    expect(voucherExpiry(londonToUtc('2027-02-28', '10:00'), 12).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
});

describe('buying a voucher', () => {
  it('checks the amount and emails', async () => {
    const { db } = await setup();
    await expect(createVoucherPurchase(db, { amountPence: 200, buyerName: 'B', buyerEmail: 'b@example.com' })).rejects.toThrow(/between/);
    await expect(createVoucherPurchase(db, { amountPence: 2500, buyerName: 'B', buyerEmail: 'b@example.com', recipientEmail: 'nope' })).rejects.toThrow(/recipient/);
  });

  it("can't be used until paid, then activates once", async () => {
    const { db } = await setup();
    const v = await createVoucherPurchase(db, { amountPence: 5000, buyerName: 'Bea', buyerEmail: 'bea@example.com', recipientName: 'Cat' });
    await expect(checkVoucher(db, v.code, NOW)).rejects.toThrow(/recognised/);
    expect((await activateVoucher(db, v.id, { paymentIntentId: 'pi_v', now: NOW })).changed).toBe(true);
    expect((await activateVoucher(db, v.id, { now: NOW })).changed).toBe(false);
    expect((await checkVoucher(db, v.code.toLowerCase(), NOW)).balancePence).toBe(5000);
  });

  it('an unpaid checkout never becomes usable', async () => {
    const { db } = await setup();
    const v = await createVoucherPurchase(db, { amountPence: 5000, buyerName: 'Bea', buyerEmail: 'bea@example.com' });
    await expireVoucherPurchase(db, v.id);
    await expect(checkVoucher(db, v.code, NOW)).rejects.toThrow(/recognised/);
  });
});

describe('paying with a voucher', () => {
  it('pays for a class in full and leaves the rest for next time', async () => {
    const { db, dance, voucher } = await setup();
    const booking = await createSessionBooking(db, { sessionId: dance[0].id, customer: alice, voucherCode: voucher.code, now: NOW });
    expect(booking.status).toBe('confirmed');
    expect(booking.paymentMethod).toBe('voucher');
    expect(booking.voucherPence).toBe(700);
    expect(await balance(db, voucher.id)).toBe(1800);
  });

  it('pays part of a course, with the rest by card', async () => {
    const { db, massage, library, voucher } = await setup();
    const { course } = await createCourse(db, {
      classTypeId: massage.id, name: 'Baby Massage', locationId: library.id, date: '2026-11-06', time: '10:30',
      durationMinutes: 55, weeks: 4, capacity: 6, pricePence: 5000, proRata: false, dropInPricePence: null,
    });
    const booking = await createCourseBooking(db, { courseId: course.id, customer: alice, voucherCode: voucher.code, now: NOW });
    expect(booking.status).toBe('pending');
    expect(booking.paymentMethod).toBe('stripe');
    expect(booking.voucherPence).toBe(2500);
    expect(await balance(db, voucher.id)).toBe(0);
    // Checkout abandoned: the voucher money comes back
    await expireBooking(db, booking.id);
    expect(await balance(db, voucher.id)).toBe(2500);
  });

  it('refunds the card part to the card and the voucher part to the voucher', async () => {
    const { db, massage, library, voucher } = await setup();
    const { course } = await createCourse(db, {
      classTypeId: massage.id, name: 'Baby Massage', locationId: library.id, date: '2026-11-06', time: '10:30',
      durationMinutes: 55, weeks: 4, capacity: 6, pricePence: 5000, proRata: false, dropInPricePence: null,
    });
    const booking = await createCourseBooking(db, { courseId: course.id, customer: alice, voucherCode: voucher.code, now: NOW });
    await confirmBooking(db, booking.id, { paymentIntentId: 'pi_c', now: NOW });
    refund.mockClear();
    const result = await cancelBooking(db, booking.id, { refund, now: NOW });
    expect(refund).toHaveBeenCalledWith('pi_c', 2500);
    expect(result.refundedPence).toBe(2500);
    expect(result.voucherReturnedPence).toBe(2500);
    expect(await balance(db, voucher.id)).toBe(2500);
  });

  it('keeps the voucher money when cancelled too late', async () => {
    const { db, dance, voucher } = await setup();
    const booking = await createSessionBooking(db, { sessionId: dance[0].id, customer: alice, voucherCode: voucher.code, now: NOW });
    const result = await cancelBooking(db, booking.id, { refund, now: londonToUtc('2026-11-02', '16:00') });
    expect(result.voucherReturnedPence).toBe(0);
    expect(await balance(db, voucher.id)).toBe(1800);
  });

  it('gives the voucher money back when Lara cancels the class', async () => {
    const { db, dance, voucher } = await setup();
    await createSessionBooking(db, { sessionId: dance[0].id, customer: alice, voucherCode: voucher.code, now: NOW });
    const { affected } = await cancelSession(db, dance[0].id, { refund, now: NOW });
    expect(affected[0].voucherReturnedPence).toBe(700);
    expect(await balance(db, voucher.id)).toBe(2500);
  });

  it('a wrong code stops the booking and takes nothing', async () => {
    const { db, dance, voucher } = await setup();
    await expect(createSessionBooking(db, { sessionId: dance[0].id, customer: alice, voucherCode: 'EW-AAAA-BBBB', now: NOW })).rejects.toThrow(/recognised/);
    expect(await balance(db, voucher.id)).toBe(2500);
  });

  it('refuses expired, cancelled and used-up vouchers', async () => {
    const { db, dance, voucher } = await setup();
    await adjustVoucher(db, voucher.id, { expiresOn: '2026-10-31' });
    await expect(createSessionBooking(db, { sessionId: dance[0].id, customer: alice, voucherCode: voucher.code, now: NOW })).rejects.toThrow(/expired/);
    await adjustVoucher(db, voucher.id, { expiresOn: '2027-12-31', balancePence: 0 });
    await expect(checkVoucher(db, voucher.code, NOW)).rejects.toThrow(/used up/);
    await adjustVoucher(db, voucher.id, { balancePence: 1000 });
    await cancelVoucher(db, voucher.id, { refund, now: NOW });
    await expect(checkVoucher(db, voucher.code, NOW)).rejects.toThrow(/cancelled/);
  });

  it('buys a pass, and gives it back if the checkout is abandoned', async () => {
    const { db, dance, voucher } = await setup();
    const type = await createPassType(db, { name: '5-class', pricePence: 3000, credits: 5, validity: 'days', validityDays: 90, classTypeIds: [dance[0].classTypeId] });
    const pass = await createPassPurchase(db, { passTypeId: type.id, customer: bea, voucherCode: voucher.code, now: NOW });
    expect(pass.status).toBe('pending');
    expect(pass.voucherPence).toBe(2500);
    await expirePassPurchase(db, pass.id);
    expect(await balance(db, voucher.id)).toBe(2500);

    const cheap = await createPassType(db, { name: 'Taster', pricePence: 1000, credits: 1, validity: 'days', validityDays: 14, classTypeIds: [dance[0].classTypeId] });
    const paid = await createPassPurchase(db, { passTypeId: cheap.id, customer: bea, voucherCode: voucher.code, now: NOW });
    expect(paid.status).toBe('active');
    expect(paid.paymentMethod).toBe('voucher');
    const result = await cancelPass(db, paid.id, { returnVoucher: true, refund, now: NOW });
    expect(result.voucherReturnedPence).toBe(1000);
    expect(await balance(db, voucher.id)).toBe(2500);
  });
});

describe('finding vouchers', () => {
  it('by code, buyer or recipient', async () => {
    const { db, voucher } = await setup();
    expect((await listVouchers(db, voucher.code.slice(3).replace('-', ''))).length).toBe(1);
    expect((await listVouchers(db, 'gran')).length).toBe(1);
    expect((await listVouchers(db, 'alice')).length).toBe(1);
    expect((await listVouchers(db, 'nobody')).length).toBe(0);
  });
});
