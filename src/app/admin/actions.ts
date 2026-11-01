'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { classTypes, locations, sessions } from '@/db/schema';
import { createLoginToken, requireAdmin } from '@/lib/auth';
import {
  BookingError,
  addManualBooking,
  cancelBooking,
  cancelSession,
  createCourse,
  createSessions,
  getBooking,
  moveRegistration,
  setAttended,
} from '@/lib/booking';
import { sendAdminLoginLink, sendBookingCancelled, sendBookingConfirmed, sendClassCancelled } from '@/lib/email';
import { poundsToPence } from '@/lib/money';
import { notifyWaitlist, safely } from '@/lib/notify';
import { appUrl, refundPayment } from '@/lib/stripe';

export type AdminState = { error?: string; ok?: string };

const str = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const num = (form: FormData, name: string) => Number(str(form, name));
const optionalId = (form: FormData, name: string) => (str(form, name) ? num(form, name) : null);

function back(path: string, message: { ok?: string; error?: string }): never {
  const q = new URLSearchParams(message as Record<string, string>).toString();
  redirect(`${path}${path.includes('?') ? '&' : '?'}${q}`);
}

function errorText(error: unknown): string {
  if (error instanceof BookingError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong';
}

// ---------------------------------------------------------------- sign in

export async function requestLoginLink(_prev: AdminState, form: FormData): Promise<AdminState> {
  const email = str(form, 'email');
  const token = await createLoginToken(getDb(), email);
  if (token) await safely(() => sendAdminLoginLink(email, `${appUrl()}/admin/auth?token=${encodeURIComponent(token)}`));
  // Same message either way, so the form doesn't reveal which emails are admins
  return { ok: 'If that email can sign in, a link is on its way. Check your inbox.' };
}

// ---------------------------------------------------------------- creating classes

export async function createSessionsAction(form: FormData) {
  await requireAdmin();
  const classTypeId = num(form, 'classTypeId');
  try {
    const [type] = await getDb().select().from(classTypes).where(eq(classTypes.id, classTypeId));
    if (!type) throw new Error('Choose a class');
    await createSessions(getDb(), {
      classTypeId,
      locationId: optionalId(form, 'locationId') ?? type.defaultLocationId,
      date: str(form, 'date'),
      time: str(form, 'time'),
      durationMinutes: num(form, 'duration') || type.defaultDurationMinutes,
      weeks: num(form, 'weeks') || 1,
      capacity: num(form, 'capacity') || type.defaultCapacity,
      pricePence: poundsToPence(str(form, 'price') || String(type.defaultPricePence / 100)),
    });
  } catch (error) {
    back('/admin/new', { error: errorText(error) });
  }
  revalidatePath('/admin');
  back('/admin', { ok: 'Classes added' });
}

export async function createCourseAction(form: FormData) {
  await requireAdmin();
  try {
    const [type] = await getDb().select().from(classTypes).where(eq(classTypes.id, num(form, 'classTypeId')));
    if (!type) throw new Error('Choose a class');
    await createCourse(getDb(), {
      classTypeId: type.id,
      name: str(form, 'name'),
      locationId: optionalId(form, 'locationId') ?? type.defaultLocationId,
      date: str(form, 'date'),
      time: str(form, 'time'),
      durationMinutes: num(form, 'duration') || 55,
      weeks: num(form, 'weeks'),
      capacity: num(form, 'capacity'),
      pricePence: poundsToPence(str(form, 'price')),
      proRata: form.get('proRata') === 'on',
      dropInPricePence: str(form, 'dropIn') ? poundsToPence(str(form, 'dropIn')) : null,
    });
  } catch (error) {
    back('/admin/new', { error: errorText(error) });
  }
  revalidatePath('/admin');
  back('/admin', { ok: 'Course added' });
}

export async function createClassTypeAction(form: FormData) {
  await requireAdmin();
  const name = str(form, 'name');
  try {
    if (!name) throw new Error('Enter a class name');
    await getDb()
      .insert(classTypes)
      .values({
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36),
        group: str(form, 'group'),
        description: str(form, 'description'),
        defaultPricePence: poundsToPence(str(form, 'price') || '0'),
        defaultCapacity: num(form, 'capacity') || 12,
        defaultDurationMinutes: num(form, 'duration') || 30,
        defaultLocationId: optionalId(form, 'locationId'),
      });
  } catch (error) {
    back('/admin/new', { error: errorText(error) });
  }
  back('/admin/new', { ok: `${name} added` });
}

export async function createLocationAction(form: FormData) {
  await requireAdmin();
  const name = str(form, 'name');
  if (!name) back('/admin/new', { error: 'Enter a venue name' });
  await getDb().insert(locations).values({ name, address: str(form, 'address'), online: form.get('online') === 'on' });
  back('/admin/new', { ok: `${name} added` });
}

// ---------------------------------------------------------------- managing a class

export async function updateSessionAction(form: FormData) {
  await requireAdmin();
  const id = num(form, 'sessionId');
  await getDb()
    .update(sessions)
    .set({ capacity: num(form, 'capacity'), notes: str(form, 'notes'), locationId: optionalId(form, 'locationId') })
    .where(eq(sessions.id, id));
  revalidatePath(`/admin/class/${id}`);
  back(`/admin/class/${id}`, { ok: 'Class updated' });
}

export async function cancelSessionAction(form: FormData) {
  await requireAdmin();
  const id = num(form, 'sessionId');
  try {
    const { session, affected } = await cancelSession(getDb(), id, { refund: refundPayment });
    const [type] = await getDb().select().from(classTypes).where(eq(classTypes.id, session.classTypeId));
    for (const a of affected) {
      await safely(() => sendClassCancelled(a.email, a.name, type?.name ?? 'Your class', session.startsAt, a.refundedPence, a.kind));
    }
  } catch (error) {
    back(`/admin/class/${id}`, { error: errorText(error) });
  }
  revalidatePath('/admin');
  back(`/admin/class/${id}`, { ok: 'Class cancelled and everyone has been emailed' });
}

export async function cancelBookingAction(form: FormData) {
  await requireAdmin();
  const sessionId = num(form, 'sessionId');
  const bookingId = str(form, 'bookingId');
  const db = getDb();
  let message = 'Booking cancelled';
  try {
    const result = await cancelBooking(db, bookingId, { refund: refundPayment, byAdmin: true, forceRefund: form.get('refund') === 'on' });
    const desc = await getBooking(db, bookingId);
    if (desc && form.get('notify') === 'on') await safely(() => sendBookingCancelled(desc, result.refundedPence));
    await notifyWaitlist(db, result.freedSessionIds);
    if (result.refundedPence > 0) message = `Booking cancelled and £${(result.refundedPence / 100).toFixed(2)} refunded`;
  } catch (error) {
    back(`/admin/class/${sessionId}`, { error: errorText(error) });
  }
  revalidatePath(`/admin/class/${sessionId}`);
  back(`/admin/class/${sessionId}`, { ok: message });
}

export async function addBookingAction(form: FormData) {
  await requireAdmin();
  const sessionId = num(form, 'sessionId');
  const db = getDb();
  try {
    const method = (str(form, 'method') || 'cash') as 'cash' | 'free' | 'manual';
    const booking = await addManualBooking(db, {
      sessionId,
      customer: { name: str(form, 'name'), email: str(form, 'email'), phone: str(form, 'phone') },
      method,
      amountPence: str(form, 'amount') ? poundsToPence(str(form, 'amount')) : 0,
      notes: str(form, 'notes'),
    });
    if (form.get('notify') === 'on') {
      const desc = await getBooking(db, booking.id);
      if (desc) await safely(() => sendBookingConfirmed(desc));
    }
  } catch (error) {
    back(`/admin/class/${sessionId}`, { error: errorText(error) });
  }
  revalidatePath(`/admin/class/${sessionId}`);
  back(`/admin/class/${sessionId}`, { ok: 'Booking added' });
}

export async function moveBookingAction(form: FormData) {
  await requireAdmin();
  const sessionId = num(form, 'sessionId');
  const db = getDb();
  try {
    const from = await moveRegistration(db, num(form, 'registrationId'), num(form, 'toSessionId'));
    await notifyWaitlist(db, [from]);
  } catch (error) {
    back(`/admin/class/${sessionId}`, { error: errorText(error) });
  }
  revalidatePath(`/admin/class/${sessionId}`);
  back(`/admin/class/${sessionId}`, { ok: 'Booking moved' });
}

export async function attendedAction(form: FormData) {
  await requireAdmin();
  const sessionId = num(form, 'sessionId');
  await setAttended(getDb(), num(form, 'registrationId'), form.get('attended') === 'true');
  revalidatePath(`/admin/class/${sessionId}`);
  redirect(`/admin/class/${sessionId}`);
}
