import { describe, expect, it, vi } from 'vitest';
import {
  BookingError,
  addManualBooking,
  cancelBooking,
  cancelSession,
  confirmBooking,
  createCourse,
  createCourseBooking,
  createSessionBooking,
  createSessions,
  expireBooking,
  getCourse,
  getSession,
  joinWaitlist,
  moveRegistration,
  register,
  remindersDue,
  takeWaitlistForFreedSessions,
} from '@/lib/booking';
import { canRefund, proRataPrice } from '@/lib/policy';
import { addLondonDays, formatTime24, londonDateKey, londonToUtc } from '@/lib/time';
import { alice, bea, cat, seedBasics, testDb } from './helpers';

const NOW = londonToUtc('2026-11-01', '12:00');

async function setup() {
  const db = await testDb();
  const base = await seedBasics(db);
  // Dance & Tone, Mondays 6:30pm, 2 places, £7
  const danceSessions = await createSessions(db, {
    classTypeId: base.dance.id,
    locationId: base.library.id,
    date: '2026-11-02',
    time: '18:30',
    durationMinutes: 30,
    weeks: 3,
    capacity: 2,
    pricePence: 700,
  });
  return { db, ...base, danceSessions };
}

const noRefund = vi.fn(async () => {});

describe('time helpers', () => {
  it('converts London wall-clock time in winter and summer', () => {
    expect(londonToUtc('2026-11-02', '18:30').toISOString()).toBe('2026-11-02T18:30:00.000Z');
    expect(londonToUtc('2026-07-06', '18:30').toISOString()).toBe('2026-07-06T17:30:00.000Z');
  });

  it('keeps the same local time across the clock change', () => {
    const before = londonToUtc('2027-03-22', '18:30'); // GMT
    const after = addLondonDays(before, 7); // BST from 28 March 2027
    expect(formatTime24(after)).toBe('18:30');
    expect(londonDateKey(after)).toBe('2027-03-29');
    expect(after.toISOString()).toBe('2027-03-29T17:30:00.000Z');
  });
});

describe('policy', () => {
  it('pro-rates courses to the nearest 50p', () => {
    expect(proRataPrice(6400, 8, 8)).toBe(6400);
    expect(proRataPrice(6400, 8, 7)).toBe(5600);
    expect(proRataPrice(5000, 4, 3)).toBe(3750);
  });

  it('applies 4 hours for pay as you go and 48 hours for courses', () => {
    const start = londonToUtc('2026-11-02', '18:30');
    expect(canRefund('session', start, londonToUtc('2026-11-02', '14:30'))).toBe(true);
    expect(canRefund('session', start, londonToUtc('2026-11-02', '14:31'))).toBe(false);
    expect(canRefund('course', start, londonToUtc('2026-10-31', '18:30'))).toBe(true);
    expect(canRefund('course', start, londonToUtc('2026-10-31', '18:31'))).toBe(false);
  });
});

describe('session bookings', () => {
  it('holds a place while paying, confirms on payment and stops at capacity', async () => {
    const { db, danceSessions } = await setup();
    const s = danceSessions[0];
    const a = await createSessionBooking(db, { sessionId: s.id, customer: alice, now: NOW });
    expect(a.status).toBe('pending');
    expect(a.amountPence).toBe(700);
    await createSessionBooking(db, { sessionId: s.id, customer: bea, now: NOW });
    expect((await getSession(db, s.id, NOW))!.spacesLeft).toBe(0);
    await expect(createSessionBooking(db, { sessionId: s.id, customer: cat, now: NOW })).rejects.toMatchObject({ code: 'full' });

    const { changed } = await confirmBooking(db, a.id, { paymentIntentId: 'pi_1', now: NOW });
    expect(changed).toBe(true);
    expect((await confirmBooking(db, a.id, { now: NOW })).changed).toBe(false); // webhook retries are harmless
  });

  it('frees the place when an unpaid hold runs out or the checkout expires', async () => {
    const { db, danceSessions } = await setup();
    const s = danceSessions[0];
    const a = await createSessionBooking(db, { sessionId: s.id, customer: alice, now: NOW });
    await createSessionBooking(db, { sessionId: s.id, customer: bea, now: NOW });
    const later = new Date(NOW.getTime() + 31 * 60000);
    expect((await getSession(db, s.id, later))!.spacesLeft).toBe(2);
    expect(await expireBooking(db, a.id)).toEqual([s.id]);
    expect((await getSession(db, s.id, NOW))!.spacesLeft).toBe(1);
  });

  it('stops the same person booking the same class twice', async () => {
    const { db, danceSessions } = await setup();
    await createSessionBooking(db, { sessionId: danceSessions[0].id, customer: alice, now: NOW });
    await expect(
      createSessionBooking(db, { sessionId: danceSessions[0].id, customer: { ...alice, email: 'alice@example.com ' }, now: NOW }),
    ).rejects.toMatchObject({ code: 'already_booked' });
  });

  it('rejects classes that have started and bad details', async () => {
    const { db, danceSessions } = await setup();
    const during = londonToUtc('2026-11-02', '18:35');
    await expect(createSessionBooking(db, { sessionId: danceSessions[0].id, customer: alice, now: during })).rejects.toMatchObject({ code: 'started' });
    await expect(
      createSessionBooking(db, { sessionId: danceSessions[0].id, customer: { email: 'nope', name: 'X' }, now: NOW }),
    ).rejects.toBeInstanceOf(BookingError);
  });
});

describe('cancelling', () => {
  it('refunds pay-as-you-go cancellations made at least 4 hours before', async () => {
    const { db, danceSessions } = await setup();
    const b = await createSessionBooking(db, { sessionId: danceSessions[0].id, customer: alice, now: NOW });
    await confirmBooking(db, b.id, { paymentIntentId: 'pi_ok', now: NOW });
    const refund = vi.fn(async () => {});
    const r = await cancelBooking(db, b.id, { refund, now: londonToUtc('2026-11-02', '14:00') });
    expect(refund).toHaveBeenCalledWith('pi_ok', 700);
    expect(r.refundedPence).toBe(700);
    expect(r.freedSessionIds).toEqual([danceSessions[0].id]);
  });

  it('cancels without a refund inside the 4 hours', async () => {
    const { db, danceSessions } = await setup();
    const b = await createSessionBooking(db, { sessionId: danceSessions[0].id, customer: alice, now: NOW });
    await confirmBooking(db, b.id, { paymentIntentId: 'pi_late', now: NOW });
    const refund = vi.fn(async () => {});
    const r = await cancelBooking(db, b.id, { refund, now: londonToUtc('2026-11-02', '17:00') });
    expect(refund).not.toHaveBeenCalled();
    expect(r.refundedPence).toBe(0);
    await expect(cancelBooking(db, b.id, { refund, now: NOW })).rejects.toMatchObject({ code: 'already_cancelled' });
  });

  it('lets Lara cancel a class and refund everyone on it', async () => {
    const { db, danceSessions } = await setup();
    const s = danceSessions[0];
    const b = await createSessionBooking(db, { sessionId: s.id, customer: alice, now: NOW });
    await confirmBooking(db, b.id, { paymentIntentId: 'pi_x', now: NOW });
    await addManualBooking(db, { sessionId: s.id, customer: bea, method: 'cash', amountPence: 700, now: NOW });
    const refund = vi.fn(async () => {});
    const { affected } = await cancelSession(db, s.id, { refund, now: londonToUtc('2026-11-02', '17:30') });
    expect(refund).toHaveBeenCalledWith('pi_x', 700); // card refunded even inside 4 hours
    expect(affected.map((a) => a.name).sort()).toEqual(['Alice', 'Bea']);
    expect((await register(db, s.id)).length).toBe(0);
  });
});

describe('waiting list', () => {
  it('tells waiting people when a place frees up', async () => {
    const { db, danceSessions } = await setup();
    const s = danceSessions[0];
    const a = await createSessionBooking(db, { sessionId: s.id, customer: alice, now: NOW });
    await confirmBooking(db, a.id, { paymentIntentId: 'pi_a', now: NOW });
    const b = await createSessionBooking(db, { sessionId: s.id, customer: bea, now: NOW });
    await confirmBooking(db, b.id, { paymentIntentId: 'pi_b', now: NOW });
    await joinWaitlist(db, { sessionId: s.id, customer: cat });
    await joinWaitlist(db, { sessionId: s.id, customer: cat }); // no duplicates
    expect(await takeWaitlistForFreedSessions(db, [s.id], NOW)).toHaveLength(0); // still full

    const { freedSessionIds } = await cancelBooking(db, a.id, { refund: noRefund, now: NOW });
    const notify = await takeWaitlistForFreedSessions(db, freedSessionIds, NOW);
    expect(notify.map((n) => n.customer.email)).toEqual(['cat@example.com']);
    expect(await takeWaitlistForFreedSessions(db, freedSessionIds, NOW)).toHaveLength(0); // only told once
  });
});

describe('courses', () => {
  async function massageCourse(proRata: boolean) {
    const { db, massage, library } = await setup();
    const { course, sessions } = await createCourse(db, {
      classTypeId: massage.id,
      name: 'Baby Massage Nov/Dec',
      locationId: library.id,
      date: '2026-11-27',
      time: '10:30',
      durationMinutes: 55,
      weeks: 4,
      capacity: 2,
      pricePence: 5000,
      proRata,
      dropInPricePence: null,
    });
    return { db, course, sessions };
  }

  it('books every session of a course for one price', async () => {
    const { db, course, sessions } = await massageCourse(false);
    const b = await createCourseBooking(db, { courseId: course.id, customer: alice, now: NOW });
    expect(b.amountPence).toBe(5000);
    for (const s of sessions) expect((await getSession(db, s.id, NOW))!.spacesLeft).toBe(1);
    await expect(createSessionBooking(db, { sessionId: sessions[1].id, customer: bea, now: NOW })).rejects.toMatchObject({ code: 'course_only' });
  });

  it('closes a non-pro-rata course once it starts', async () => {
    const { db, course } = await massageCourse(false);
    const after = londonToUtc('2026-11-28', '09:00');
    const detail = await getCourse(db, course.id, after);
    expect(detail!.bookable).toBe(false);
    await expect(createCourseBooking(db, { courseId: course.id, customer: alice, now: after })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('charges only for the sessions left on a pro-rata course', async () => {
    const { db, course } = await massageCourse(true);
    const after = londonToUtc('2026-11-28', '09:00');
    const b = await createCourseBooking(db, { courseId: course.id, customer: alice, now: after });
    expect(b.amountPence).toBe(3750);
  });

  it('needs 48 hours notice for a course refund', async () => {
    const { db, course } = await massageCourse(false);
    const b = await createCourseBooking(db, { courseId: course.id, customer: alice, now: NOW });
    await confirmBooking(db, b.id, { paymentIntentId: 'pi_c', now: NOW });
    const refund = vi.fn(async () => {});
    await cancelBooking(db, b.id, { refund, now: londonToUtc('2026-11-26', '09:00') });
    expect(refund).not.toHaveBeenCalled();
  });
});

describe('admin tools', () => {
  it('moves someone to another class with space', async () => {
    const { db, danceSessions } = await setup();
    const b = await addManualBooking(db, { sessionId: danceSessions[0].id, customer: alice, method: 'free', now: NOW });
    const [reg] = await register(db, danceSessions[0].id);
    expect(reg.booking.id).toBe(b.id);
    await moveRegistration(db, reg.registration.id, danceSessions[1].id, NOW);
    expect(await register(db, danceSessions[0].id)).toHaveLength(0);
    expect(await register(db, danceSessions[1].id)).toHaveLength(1);
  });

  it('finds tomorrow’s bookings for reminder emails', async () => {
    const { db, danceSessions } = await setup();
    const b = await createSessionBooking(db, { sessionId: danceSessions[0].id, customer: alice, now: NOW });
    await confirmBooking(db, b.id, { paymentIntentId: 'pi_r', now: NOW });
    await createSessionBooking(db, { sessionId: danceSessions[0].id, customer: bea, now: NOW }); // unpaid: no reminder
    const due = await remindersDue(db, londonToUtc('2026-11-01', '09:00'));
    expect(due.map((d) => d.customer.name)).toEqual(['Alice']);
    expect(await remindersDue(db, londonToUtc('2026-11-03', '09:00'))).toHaveLength(0);
  });

  it('creates weekly classes that stay at 6:30pm across the clock change', async () => {
    const { db, dance, library } = await setup();
    const created = await createSessions(db, {
      classTypeId: dance.id,
      locationId: library.id,
      date: '2027-03-22',
      time: '18:30',
      durationMinutes: 30,
      weeks: 2,
      capacity: 10,
      pricePence: 700,
    });
    expect(created.map((s) => formatTime24(s.startsAt))).toEqual(['18:30', '18:30']);
  });
});
