// The booking engine: spaces, holds, confirmation, cancellation, waiting list and
// Lara's admin actions. Every function takes the database as its first argument so
// it can be tested against an in-memory Postgres.

import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';
import { bookings, classTypes, courses, customers, locations, registrations, sessions, waitlist } from '@/db/schema';
import { HOLD_MINUTES, canRefund, cancellationDeadline, proRataPrice } from './policy';
import { addLondonDays, addMinutes, londonDateKey, londonToUtc } from './time';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, any>;

export class BookingError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type CustomerInput = { email: string; name: string; phone?: string };

export type Booking = typeof bookings.$inferSelect;
export type Session = typeof sessions.$inferSelect;

// ---------------------------------------------------------------- spaces

// A place is taken by a confirmed booking, or by a pending one whose payment hold hasn't expired
function takenCondition(now: Date) {
  return and(
    eq(registrations.status, 'active'),
    or(eq(bookings.status, 'confirmed'), and(eq(bookings.status, 'pending'), gt(bookings.holdExpiresAt, now))),
  );
}

export async function takenCounts(db: Db, sessionIds: number[], now = new Date()): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (!sessionIds.length) return counts;
  const rows = await db
    .select({ sessionId: registrations.sessionId, taken: sql<number>`count(*)::int` })
    .from(registrations)
    .innerJoin(bookings, eq(bookings.id, registrations.bookingId))
    .where(and(inArray(registrations.sessionId, sessionIds), takenCondition(now)))
    .groupBy(registrations.sessionId);
  for (const r of rows) counts.set(r.sessionId, Number(r.taken));
  return counts;
}

// ---------------------------------------------------------------- reading

export type ScheduleItem = {
  session: Session;
  classType: typeof classTypes.$inferSelect;
  location: typeof locations.$inferSelect | null;
  course: typeof courses.$inferSelect | null;
  taken: number;
  spacesLeft: number;
};

export async function listSessions(
  db: Db,
  opts: { from: Date; to: Date; group?: string; includeCancelled?: boolean; now?: Date },
): Promise<ScheduleItem[]> {
  const where = [gte(sessions.startsAt, opts.from), lt(sessions.startsAt, opts.to)];
  if (!opts.includeCancelled) where.push(eq(sessions.status, 'scheduled'));
  if (opts.group) where.push(eq(classTypes.group, opts.group));
  const rows = await db
    .select({ session: sessions, classType: classTypes, location: locations, course: courses })
    .from(sessions)
    .innerJoin(classTypes, eq(classTypes.id, sessions.classTypeId))
    .leftJoin(locations, eq(locations.id, sessions.locationId))
    .leftJoin(courses, eq(courses.id, sessions.courseId))
    .where(and(...where))
    .orderBy(asc(sessions.startsAt));
  const counts = await takenCounts(db, rows.map((r) => r.session.id), opts.now);
  return rows.map((r) => {
    const taken = counts.get(r.session.id) ?? 0;
    return { ...r, taken, spacesLeft: Math.max(r.session.capacity - taken, 0) };
  });
}

export async function getSession(db: Db, id: number, now = new Date()): Promise<ScheduleItem | null> {
  const rows = await db
    .select({ session: sessions, classType: classTypes, location: locations, course: courses })
    .from(sessions)
    .innerJoin(classTypes, eq(classTypes.id, sessions.classTypeId))
    .leftJoin(locations, eq(locations.id, sessions.locationId))
    .leftJoin(courses, eq(courses.id, sessions.courseId))
    .where(eq(sessions.id, id));
  if (!rows.length) return null;
  const taken = (await takenCounts(db, [id], now)).get(id) ?? 0;
  return { ...rows[0], taken, spacesLeft: Math.max(rows[0].session.capacity - taken, 0) };
}

export type CourseDetail = {
  course: typeof courses.$inferSelect;
  classType: typeof classTypes.$inferSelect;
  location: typeof locations.$inferSelect | null;
  sessions: Session[];
  remaining: Session[];
  pricePence: number;
  spacesLeft: number;
  bookable: boolean;
  reason?: string;
};

export async function getCourse(db: Db, id: number, now = new Date()): Promise<CourseDetail | null> {
  const [row] = await db
    .select({ course: courses, classType: classTypes })
    .from(courses)
    .innerJoin(classTypes, eq(classTypes.id, courses.classTypeId))
    .where(eq(courses.id, id));
  if (!row) return null;
  const all = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.courseId, id), eq(sessions.status, 'scheduled')))
    .orderBy(asc(sessions.startsAt));
  const remaining = all.filter((s) => s.startsAt > now);
  const [location] = all[0]?.locationId
    ? await db.select().from(locations).where(eq(locations.id, all[0].locationId))
    : [null];
  const counts = await takenCounts(db, remaining.map((s) => s.id), now);
  const spacesLeft = remaining.length
    ? Math.min(...remaining.map((s) => Math.max(s.capacity - (counts.get(s.id) ?? 0), 0)))
    : 0;
  const started = all.length > 0 && all[0].startsAt <= now;
  let bookable = remaining.length > 0 && spacesLeft > 0;
  let reason: string | undefined;
  if (!remaining.length) reason = 'This course has finished.';
  else if (started && !row.course.proRata) {
    bookable = false;
    reason = 'This course has already started. Keep an eye out for the next one!';
  } else if (spacesLeft <= 0) reason = 'This course is fully booked.';
  return {
    ...row,
    location: location ?? null,
    sessions: all,
    remaining,
    pricePence: row.course.proRata ? proRataPrice(row.course.pricePence, all.length, remaining.length) : row.course.pricePence,
    spacesLeft,
    bookable,
    reason,
  };
}

export async function listCourses(db: Db, now = new Date()) {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .innerJoin(sessions, eq(sessions.courseId, courses.id))
    .where(and(gt(sessions.startsAt, now), eq(sessions.status, 'scheduled')))
    .groupBy(courses.id);
  const details = await Promise.all(rows.map((r) => getCourse(db, r.id, now)));
  return details.filter((d): d is CourseDetail => !!d).sort((a, b) => +a.remaining[0].startsAt - +b.remaining[0].startsAt);
}

// ---------------------------------------------------------------- customers

function cleanEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function upsertCustomer(db: Db, input: CustomerInput) {
  const email = cleanEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BookingError('invalid_email', 'Please enter a valid email address.');
  const name = input.name.trim();
  if (!name) throw new BookingError('invalid_name', 'Please enter your name.');
  const [customer] = await db
    .insert(customers)
    .values({ email, name, phone: (input.phone ?? '').trim() })
    .onConflictDoUpdate({ target: customers.email, set: { name, phone: sql`coalesce(nullif(excluded.phone, ''), ${customers.phone})` } })
    .returning();
  return customer;
}

// ---------------------------------------------------------------- booking

function newBookingValues(customerId: number, now: Date, amountPence: number) {
  return {
    id: randomUUID(),
    customerId,
    amountPence,
    manageToken: randomBytes(24).toString('base64url'),
    status: amountPence === 0 ? 'confirmed' : 'pending',
    paymentMethod: amountPence === 0 ? 'free' : 'stripe',
    holdExpiresAt: amountPence === 0 ? null : addMinutes(now, HOLD_MINUTES),
    confirmedAt: amountPence === 0 ? now : null,
  } as const;
}

export async function createSessionBooking(
  db: Db,
  input: { sessionId: number; customer: CustomerInput; now?: Date },
): Promise<Booking> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // Lock the session row so two people can't take the last place at once
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, input.sessionId)).for('update');
    if (!session || session.status !== 'scheduled') throw new BookingError('unavailable', 'This class is no longer available.');
    if (session.startsAt <= now) throw new BookingError('started', 'This class has already started.');
    if (session.pricePence === null) throw new BookingError('course_only', 'This class can only be booked as part of its course.');
    const taken = (await takenCounts(tx, [session.id], now)).get(session.id) ?? 0;
    if (taken >= session.capacity) throw new BookingError('full', 'Sorry, this class is now fully booked.');

    const customer = await upsertCustomer(tx, input.customer);
    await assertNotAlreadyBooked(tx, customer.id, [session.id], now);
    const [booking] = await tx
      .insert(bookings)
      .values({ ...newBookingValues(customer.id, now, session.pricePence), kind: 'session', sessionId: session.id })
      .returning();
    await tx.insert(registrations).values({ bookingId: booking.id, sessionId: session.id });
    return booking;
  });
}

export async function createCourseBooking(
  db: Db,
  input: { courseId: number; customer: CustomerInput; now?: Date },
): Promise<Booking> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [course] = await tx.select().from(courses).where(eq(courses.id, input.courseId)).for('update');
    if (!course) throw new BookingError('unavailable', 'This course is no longer available.');
    const detail = await getCourse(tx, course.id, now);
    if (!detail || !detail.bookable) throw new BookingError('unavailable', detail?.reason ?? 'This course is not available.');

    const customer = await upsertCustomer(tx, input.customer);
    const sessionIds = detail.remaining.map((s) => s.id);
    await assertNotAlreadyBooked(tx, customer.id, sessionIds, now);
    const [booking] = await tx
      .insert(bookings)
      .values({ ...newBookingValues(customer.id, now, detail.pricePence), kind: 'course', courseId: course.id })
      .returning();
    await tx.insert(registrations).values(sessionIds.map((sessionId) => ({ bookingId: booking.id, sessionId })));
    return booking;
  });
}

async function assertNotAlreadyBooked(db: Db, customerId: number, sessionIds: number[], now: Date) {
  const existing = await db
    .select({ id: registrations.id })
    .from(registrations)
    .innerJoin(bookings, eq(bookings.id, registrations.bookingId))
    .where(and(eq(bookings.customerId, customerId), inArray(registrations.sessionId, sessionIds), takenCondition(now)))
    .limit(1);
  if (existing.length) throw new BookingError('already_booked', "You're already booked on this. Check your email for your confirmation.");
}

export async function setCheckoutId(db: Db, bookingId: string, checkoutId: string) {
  await db.update(bookings).set({ stripeCheckoutId: checkoutId }).where(eq(bookings.id, bookingId));
}

// Called from the Stripe webhook once payment succeeds. Safe to call twice.
export async function confirmBooking(db: Db, bookingId: string, opts: { paymentIntentId?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) throw new BookingError('not_found', 'Booking not found');
  if (booking.status === 'confirmed') return { booking, changed: false };
  // A payment that arrives after an expiry still confirms: the customer has paid
  const [updated] = await db
    .update(bookings)
    .set({ status: 'confirmed', confirmedAt: now, holdExpiresAt: null, stripePaymentIntentId: opts.paymentIntentId ?? booking.stripePaymentIntentId })
    .where(eq(bookings.id, bookingId))
    .returning();
  await db.update(registrations).set({ status: 'active' }).where(eq(registrations.bookingId, bookingId));
  return { booking: updated, changed: true };
}

// Called when a Stripe checkout expires unpaid. Frees the held places.
export async function expireBooking(db: Db, bookingId: string): Promise<number[]> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking || booking.status !== 'pending') return [];
  await db.update(bookings).set({ status: 'expired', holdExpiresAt: null }).where(eq(bookings.id, bookingId));
  const regs = await db
    .update(registrations)
    .set({ status: 'cancelled' })
    .where(eq(registrations.bookingId, bookingId))
    .returning({ sessionId: registrations.sessionId });
  return regs.map((r) => r.sessionId);
}

export async function getBookingByToken(db: Db, token: string) {
  const [booking] = await db.select().from(bookings).where(eq(bookings.manageToken, token));
  return booking ? describeBooking(db, booking) : null;
}

export async function getBooking(db: Db, id: string) {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
  return booking ? describeBooking(db, booking) : null;
}

export type BookingDescription = Awaited<ReturnType<typeof describeBooking>>;

export async function describeBooking(db: Db, booking: Booking) {
  const [customer] = await db.select().from(customers).where(eq(customers.id, booking.customerId));
  const regs = await db
    .select({ registration: registrations, session: sessions, classType: classTypes, location: locations })
    .from(registrations)
    .innerJoin(sessions, eq(sessions.id, registrations.sessionId))
    .innerJoin(classTypes, eq(classTypes.id, sessions.classTypeId))
    .leftJoin(locations, eq(locations.id, sessions.locationId))
    .where(eq(registrations.bookingId, booking.id))
    .orderBy(asc(sessions.startsAt));
  const course = booking.courseId ? (await db.select().from(courses).where(eq(courses.id, booking.courseId)))[0] ?? null : null;
  const first = regs[0]?.session.startsAt;
  const kind = booking.kind as 'session' | 'course';
  return {
    booking,
    customer,
    course,
    title: course?.name ?? regs[0]?.classType.name ?? 'Booking',
    sessions: regs,
    firstStart: first ?? null,
    refundDeadline: first ? cancellationDeadline(kind, first) : null,
  };
}

// ---------------------------------------------------------------- cancelling

export type RefundFn = (paymentIntentId: string, amountPence: number) => Promise<void>;

export type CancelResult = { refundedPence: number; freedSessionIds: number[] };

// Cancels a whole booking. Customers get a refund only within Lara's notice periods;
// Lara (byAdmin) can choose to refund regardless.
export async function cancelBooking(
  db: Db,
  bookingId: string,
  opts: { refund: RefundFn; byAdmin?: boolean; forceRefund?: boolean; now?: Date },
): Promise<CancelResult> {
  const now = opts.now ?? new Date();
  const desc = await getBooking(db, bookingId);
  if (!desc) throw new BookingError('not_found', 'Booking not found');
  const { booking, firstStart } = desc;
  if (booking.status === 'cancelled' || booking.status === 'expired') throw new BookingError('already_cancelled', 'This booking has already been cancelled.');
  if (!opts.byAdmin && firstStart && firstStart <= now) throw new BookingError('started', 'This has already started, so it can no longer be cancelled online.');

  const eligible = firstStart ? canRefund(booking.kind as 'session' | 'course', firstStart, now) : true;
  const shouldRefund = booking.status === 'confirmed' && booking.paymentMethod === 'stripe' && (opts.forceRefund || eligible);
  const refundPence = shouldRefund ? booking.amountPence - booking.refundedPence : 0;
  if (refundPence > 0) {
    if (!booking.stripePaymentIntentId) throw new BookingError('no_payment', 'No card payment found to refund.');
    await opts.refund(booking.stripePaymentIntentId, refundPence);
  }
  await db
    .update(bookings)
    .set({ status: 'cancelled', cancelledAt: now, refundedPence: booking.refundedPence + refundPence, holdExpiresAt: null })
    .where(eq(bookings.id, bookingId));
  const regs = await db
    .update(registrations)
    .set({ status: 'cancelled' })
    .where(and(eq(registrations.bookingId, bookingId), eq(registrations.status, 'active')))
    .returning({ sessionId: registrations.sessionId });
  return { refundedPence: refundPence, freedSessionIds: regs.map((r) => r.sessionId) };
}

// ---------------------------------------------------------------- waiting list

export async function joinWaitlist(db: Db, input: { sessionId?: number; courseId?: number; customer: CustomerInput }) {
  const customer = await upsertCustomer(db, input.customer);
  const target = input.sessionId ? eq(waitlist.sessionId, input.sessionId) : eq(waitlist.courseId, input.courseId!);
  const existing = await db
    .select()
    .from(waitlist)
    .where(and(target, eq(waitlist.customerId, customer.id), isNull(waitlist.notifiedAt)));
  if (existing.length) return existing[0];
  const [entry] = await db
    .insert(waitlist)
    .values({ sessionId: input.sessionId ?? null, courseId: input.courseId ?? null, customerId: customer.id })
    .returning();
  return entry;
}

// People to tell that a place has opened, for sessions (and their courses) that now have space.
// Everyone waiting is told at once; the first to book gets the place. Marks them notified.
export async function takeWaitlistForFreedSessions(db: Db, sessionIds: number[], now = new Date()) {
  if (!sessionIds.length) return [];
  const freed = await db.select().from(sessions).where(inArray(sessions.id, sessionIds));
  const counts = await takenCounts(db, sessionIds, now);
  const withSpace = freed.filter((s) => s.status === 'scheduled' && s.startsAt > now && (counts.get(s.id) ?? 0) < s.capacity);
  if (!withSpace.length) return [];
  const courseIds = [...new Set(withSpace.map((s) => s.courseId).filter((c): c is number => c !== null))];
  const conditions = [inArray(waitlist.sessionId, withSpace.map((s) => s.id))];
  if (courseIds.length) conditions.push(inArray(waitlist.courseId, courseIds));
  const entries = await db
    .select({ entry: waitlist, customer: customers })
    .from(waitlist)
    .innerJoin(customers, eq(customers.id, waitlist.customerId))
    .where(and(isNull(waitlist.notifiedAt), or(...conditions)));
  if (entries.length) {
    await db.update(waitlist).set({ notifiedAt: now }).where(inArray(waitlist.id, entries.map((e) => e.entry.id)));
  }
  return entries;
}

// ---------------------------------------------------------------- admin

export async function createSessions(
  db: Db,
  input: {
    classTypeId: number;
    locationId: number | null;
    date: string; // first date, YYYY-MM-DD (London)
    time: string; // HH:MM (London)
    durationMinutes: number;
    weeks: number;
    capacity: number;
    pricePence: number | null;
    courseId?: number | null;
  },
) {
  if (input.weeks < 1 || input.weeks > 52) throw new BookingError('invalid', 'Choose between 1 and 52 weeks.');
  const first = londonToUtc(input.date, input.time);
  const values = Array.from({ length: input.weeks }, (_, i) => {
    const startsAt = addLondonDays(first, i * 7);
    return {
      classTypeId: input.classTypeId,
      courseId: input.courseId ?? null,
      locationId: input.locationId,
      startsAt,
      endsAt: addMinutes(startsAt, input.durationMinutes),
      capacity: input.capacity,
      pricePence: input.pricePence,
    };
  });
  return db.insert(sessions).values(values).returning();
}

export async function createCourse(
  db: Db,
  input: {
    classTypeId: number;
    name: string;
    locationId: number | null;
    date: string;
    time: string;
    durationMinutes: number;
    weeks: number;
    capacity: number;
    pricePence: number;
    proRata: boolean;
    dropInPricePence: number | null;
  },
) {
  return db.transaction(async (tx) => {
    const [course] = await tx
      .insert(courses)
      .values({
        classTypeId: input.classTypeId,
        name: input.name,
        pricePence: input.pricePence,
        capacity: input.capacity,
        proRata: input.proRata,
        allowDropIn: input.dropInPricePence !== null,
      })
      .returning();
    const created = await createSessions(tx, {
      classTypeId: input.classTypeId,
      locationId: input.locationId,
      date: input.date,
      time: input.time,
      durationMinutes: input.durationMinutes,
      weeks: input.weeks,
      capacity: input.capacity,
      pricePence: input.dropInPricePence,
      courseId: course.id,
    });
    return { course, sessions: created };
  });
}

export async function register(db: Db, sessionId: number) {
  return db
    .select({ registration: registrations, booking: bookings, customer: customers })
    .from(registrations)
    .innerJoin(bookings, eq(bookings.id, registrations.bookingId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(and(eq(registrations.sessionId, sessionId), eq(registrations.status, 'active'), eq(bookings.status, 'confirmed')))
    .orderBy(asc(customers.name));
}

export async function setAttended(db: Db, registrationId: number, attended: boolean) {
  await db.update(registrations).set({ attended }).where(eq(registrations.id, registrationId));
}

// Lara adds someone herself (paid cash, a gift, a make-up session...)
export async function addManualBooking(
  db: Db,
  input: { sessionId: number; customer: CustomerInput; method: 'cash' | 'free' | 'manual'; amountPence?: number; notes?: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, input.sessionId)).for('update');
    if (!session) throw new BookingError('not_found', 'Class not found');
    const customer = await upsertCustomer(tx, input.customer);
    await assertNotAlreadyBooked(tx, customer.id, [session.id], now);
    const [booking] = await tx
      .insert(bookings)
      .values({
        ...newBookingValues(customer.id, now, 0),
        kind: 'session',
        sessionId: session.id,
        amountPence: input.amountPence ?? 0,
        paymentMethod: input.method,
        notes: input.notes ?? '',
      })
      .returning();
    await tx.insert(registrations).values({ bookingId: booking.id, sessionId: session.id });
    return booking;
  });
}

// Moves one person's place from one session to another (a transfer or make-up class)
export async function moveRegistration(db: Db, registrationId: number, toSessionId: number, now = new Date()) {
  return db.transaction(async (tx) => {
    const [reg] = await tx.select().from(registrations).where(eq(registrations.id, registrationId));
    if (!reg || reg.status !== 'active') throw new BookingError('not_found', 'Booking not found');
    const [target] = await tx.select().from(sessions).where(eq(sessions.id, toSessionId)).for('update');
    if (!target || target.status !== 'scheduled') throw new BookingError('unavailable', 'That class is not available.');
    const taken = (await takenCounts(tx, [target.id], now)).get(target.id) ?? 0;
    if (taken >= target.capacity) throw new BookingError('full', 'That class is full.');
    const clash = await tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.bookingId, reg.bookingId), eq(registrations.sessionId, toSessionId)));
    if (clash.length) throw new BookingError('already_booked', 'They are already booked on that class.');
    await tx.update(registrations).set({ sessionId: toSessionId, reminderSentAt: null, attended: false }).where(eq(registrations.id, registrationId));
    return reg.sessionId;
  });
}

// Lara cancels a class. Pay-as-you-go bookings are refunded in full and cancelled;
// course bookings keep their other sessions (Lara can arrange a make-up or partial refund).
export async function cancelSession(db: Db, sessionId: number, opts: { refund: RefundFn; now?: Date }) {
  const now = opts.now ?? new Date();
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) throw new BookingError('not_found', 'Class not found');
  const attendees = await register(db, sessionId);
  await db.update(sessions).set({ status: 'cancelled' }).where(eq(sessions.id, sessionId));
  const results: { email: string; name: string; refundedPence: number; kind: string }[] = [];
  for (const a of attendees) {
    if (a.booking.kind === 'session') {
      const r = await cancelBooking(db, a.booking.id, { refund: opts.refund, byAdmin: true, forceRefund: true, now });
      results.push({ email: a.customer.email, name: a.customer.name, refundedPence: r.refundedPence, kind: 'session' });
    } else {
      await db.update(registrations).set({ status: 'cancelled' }).where(eq(registrations.id, a.registration.id));
      results.push({ email: a.customer.email, name: a.customer.name, refundedPence: 0, kind: 'course' });
    }
  }
  return { session, affected: results };
}

// Registrations for sessions on tomorrow's date (London) that haven't had a reminder
export async function remindersDue(db: Db, now = new Date()) {
  const tomorrow = londonDateKey(addLondonDays(now, 1));
  const from = londonToUtc(tomorrow, '00:00');
  const to = londonToUtc(londonDateKey(addLondonDays(from, 1)), '00:00');
  return db
    .select({ registration: registrations, booking: bookings, customer: customers, session: sessions, classType: classTypes, location: locations })
    .from(registrations)
    .innerJoin(bookings, eq(bookings.id, registrations.bookingId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .innerJoin(sessions, eq(sessions.id, registrations.sessionId))
    .innerJoin(classTypes, eq(classTypes.id, sessions.classTypeId))
    .leftJoin(locations, eq(locations.id, sessions.locationId))
    .where(
      and(
        eq(registrations.status, 'active'),
        eq(bookings.status, 'confirmed'),
        eq(sessions.status, 'scheduled'),
        gte(sessions.startsAt, from),
        lt(sessions.startsAt, to),
        isNull(registrations.reminderSentAt),
      ),
    );
}

export async function markReminderSent(db: Db, registrationId: number, now = new Date()) {
  await db.update(registrations).set({ reminderSentAt: now }).where(eq(registrations.id, registrationId));
}
