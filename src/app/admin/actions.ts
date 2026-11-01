'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { classTypes, customers, locations, sessions } from '@/db/schema';
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
  findOrAddCustomer,
  register,
  upsertCustomer,
} from '@/lib/booking';
import { adjustPass, bookWithPass, cancelPass, createPassType, grantPass, passesForSession, searchCustomers, setPassTypeOnSale } from '@/lib/passes';
import { sendAdminLoginLink, sendBookingCancelled, sendBookingConfirmed, sendClassCancelled } from '@/lib/email';
import { poundsToPence } from '@/lib/money';
import { notifyPassReady, notifyVoucherReady, notifyWaitlist, passLeftText, safely } from '@/lib/notify';
import { adjustVoucher, cancelVoucher, grantVoucher } from '@/lib/vouchers';
import { importClients, readClients } from '@/lib/importClients';
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
      await safely(() => sendClassCancelled(a.email, a.name, type?.name ?? 'Your class', session.startsAt, a.refundedPence, a.kind, a.creditReturned, a.voucherReturnedPence));
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
    if (desc && form.get('notify') === 'on') await safely(() => sendBookingCancelled(desc, result.refundedPence, result.creditReturned, result.voucherReturnedPence));
    await notifyWaitlist(db, result.freedSessionIds);
    if (result.refundedPence > 0) message = `Booking cancelled and £${(result.refundedPence / 100).toFixed(2)} refunded`;
    else if (result.voucherReturnedPence > 0) message = `Booking cancelled and £${(result.voucherReturnedPence / 100).toFixed(2)} put back on their gift voucher`;
    else if (result.creditReturned) message = 'Booking cancelled and the class put back on their pass';
  } catch (error) {
    back(`/admin/class/${sessionId}`, { error: errorText(error) });
  }
  revalidatePath(`/admin/class/${sessionId}`);
  back(`/admin/class/${sessionId}`, { ok: message });
}

export async function addBookingAction(form: FormData) {
  await requireAdmin();
  const sessionId = num(form, 'sessionId');
  // Lara can add someone from the class page or from a client's page
  const returnTo = str(form, 'returnTo').startsWith('/admin/') ? str(form, 'returnTo') : `/admin/class/${sessionId}`;
  const db = getDb();
  const method = (str(form, 'method') || 'cash') as 'cash' | 'free' | 'manual' | 'pass';
  const customerId = optionalId(form, 'customerId');
  const details = { name: str(form, 'name'), email: str(form, 'email'), phone: str(form, 'phone') };
  try {
    if (!sessionId) throw new Error('Choose a class');
    if (!customerId && !details.email) throw new Error('Choose a client, or enter a new client’s details');
    const clientId = customerId ?? (await findOrAddCustomer(db, details)).id;
    const booking = method === 'pass'
      ? await bookWithPass(db, { sessionId, customerId: clientId, byAdmin: true })
      : await addManualBooking(db, {
          sessionId,
          customerId: clientId,
          method,
          amountPence: str(form, 'amount') ? poundsToPence(str(form, 'amount')) : 0,
          notes: str(form, 'notes'),
        });
    if (form.get('notify') === 'on') {
      const desc = await getBooking(db, booking.id);
      const left = await passLeftText(db, booking.passId);
      if (desc) await safely(() => sendBookingConfirmed(desc, left));
    }
  } catch (error) {
    back(returnTo, { error: errorText(error) });
  }
  revalidatePath(returnTo);
  back(returnTo, { ok: method === 'pass' ? 'Booked with their pass' : 'Booking added' });
}

// Client search for the "Add someone" box: matching clients, whether they're already
// booked on this class, and the pass they'd use for it
export async function findClientsForClass(query: string, sessionId: number) {
  await requireAdmin();
  const q = query.trim();
  if (q.length < 2) return [];
  const db = getDb();
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  const clients = await searchCustomers(db, q, 8);
  const booked = new Set(session ? (await register(db, sessionId)).map((r) => r.customer.id) : []);
  return Promise.all(
    clients.map(async (c) => {
      const passes = session ? await passesForSession(db, c.id, session) : [];
      const p = passes[0];
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        booked: booked.has(c.id),
        pass: p ? `${p.type.name} (${p.creditsLeft === null ? 'unlimited' : `${p.creditsLeft} left`})` : null,
      };
    }),
  );
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

// ---------------------------------------------------------------- passes

export async function createPassTypeAction(form: FormData) {
  await requireAdmin();
  const validity = str(form, 'validity') === 'dates' ? 'dates' : 'days';
  try {
    await createPassType(getDb(), {
      name: str(form, 'name'),
      description: str(form, 'description'),
      pricePence: poundsToPence(str(form, 'price') || '0'),
      credits: str(form, 'credits') ? num(form, 'credits') : null,
      validity,
      validityDays: validity === 'days' ? num(form, 'days') : null,
      validFrom: validity === 'dates' ? str(form, 'from') : null,
      validUntil: validity === 'dates' ? str(form, 'until') : null,
      onSale: form.get('onSale') === 'on',
      classTypeIds: form.getAll('classTypeIds').map(Number).filter(Boolean),
    });
  } catch (error) {
    back('/admin/passes', { error: errorText(error) });
  }
  revalidatePath('/admin/passes');
  back('/admin/passes', { ok: `${str(form, 'name')} added` });
}

export async function passTypeOnSaleAction(form: FormData) {
  await requireAdmin();
  await setPassTypeOnSale(getDb(), num(form, 'passTypeId'), form.get('onSale') === 'true');
  revalidatePath('/admin/passes');
  back('/admin/passes', { ok: form.get('onSale') === 'true' ? 'Pass is on sale' : 'Pass taken off sale' });
}

export async function grantPassAction(form: FormData) {
  await requireAdmin();
  const customerId = num(form, 'customerId');
  const path = `/admin/clients/${customerId}`;
  const db = getDb();
  try {
    const method = (str(form, 'method') || 'free') as 'free' | 'cash' | 'manual';
    const pass = await grantPass(db, {
      passTypeId: num(form, 'passTypeId'),
      customerId,
      method,
      amountPence: str(form, 'amount') ? poundsToPence(str(form, 'amount')) : 0,
      notes: str(form, 'notes'),
    });
    // Moving a pass over from Bookwhen: set the classes left and its end date
    if (str(form, 'creditsLeft') || str(form, 'expiresOn')) {
      await adjustPass(db, pass.id, {
        creditsTotal: str(form, 'creditsLeft') && pass.creditsTotal !== null ? num(form, 'creditsLeft') : undefined,
        expiresOn: str(form, 'expiresOn') || null,
      });
    }
    if (form.get('notify') === 'on') await notifyPassReady(db, pass.id);
  } catch (error) {
    back(path, { error: errorText(error) });
  }
  revalidatePath(path);
  back(path, { ok: 'Pass added' });
}

export async function adjustPassAction(form: FormData) {
  await requireAdmin();
  const path = `/admin/clients/${num(form, 'customerId')}`;
  try {
    await adjustPass(getDb(), str(form, 'passId'), {
      creditsTotal: form.has('credits') ? (str(form, 'credits') ? num(form, 'credits') : null) : undefined,
      expiresOn: str(form, 'expiresOn') || null,
      notes: str(form, 'notes'),
    });
  } catch (error) {
    back(path, { error: errorText(error) });
  }
  revalidatePath(path);
  back(path, { ok: 'Pass updated' });
}

export async function cancelPassAction(form: FormData) {
  await requireAdmin();
  const path = `/admin/clients/${num(form, 'customerId')}`;
  let message = 'Pass cancelled';
  try {
    const refundPence = str(form, 'refund') ? poundsToPence(str(form, 'refund')) : 0;
    const result = await cancelPass(getDb(), str(form, 'passId'), { refundPence, returnVoucher: form.get('returnVoucher') === 'on', refund: refundPayment });
    if (result.refundedPence > 0) message = `Pass cancelled and £${(result.refundedPence / 100).toFixed(2)} refunded`;
    if (result.voucherReturnedPence > 0) message += `, £${(result.voucherReturnedPence / 100).toFixed(2)} back on their gift voucher`;
  } catch (error) {
    back(path, { error: errorText(error) });
  }
  revalidatePath(path);
  back(path, { ok: message });
}

export async function updateClientAction(form: FormData) {
  await requireAdmin();
  const id = num(form, 'customerId');
  const name = str(form, 'name');
  if (!name) back(`/admin/clients/${id}`, { error: 'Enter a name' });
  await getDb().update(customers).set({ name, phone: str(form, 'phone') }).where(eq(customers.id, id));
  revalidatePath(`/admin/clients/${id}`);
  back(`/admin/clients/${id}`, { ok: 'Details saved' });
}

export async function addClientAction(form: FormData) {
  await requireAdmin();
  let id = 0;
  try {
    id = (await upsertCustomer(getDb(), { name: str(form, 'name'), email: str(form, 'email'), phone: str(form, 'phone') })).id;
  } catch (error) {
    back('/admin/clients', { error: errorText(error) });
  }
  back(`/admin/clients/${id}`, { ok: 'Client saved' });
}

// ---------------------------------------------------------------- gift vouchers

export async function grantVoucherAction(form: FormData) {
  await requireAdmin();
  const db = getDb();
  let id = '';
  try {
    const voucher = await grantVoucher(db, {
      amountPence: poundsToPence(str(form, 'amount')),
      buyerName: str(form, 'buyerName') || 'Eir & Wild',
      buyerEmail: str(form, 'buyerEmail'),
      recipientName: str(form, 'recipientName'),
      recipientEmail: str(form, 'recipientEmail'),
      message: str(form, 'message'),
      method: (str(form, 'method') || 'free') as 'free' | 'cash' | 'manual',
      notes: str(form, 'notes'),
    });
    id = voucher.id;
    if (form.get('notify') === 'on') await notifyVoucherReady(db, voucher.id);
  } catch (error) {
    back('/admin/vouchers', { error: errorText(error) });
  }
  revalidatePath('/admin/vouchers');
  back(`/admin/vouchers/${id}`, { ok: 'Voucher created' });
}

export async function adjustVoucherAction(form: FormData) {
  await requireAdmin();
  const id = str(form, 'voucherId');
  try {
    await adjustVoucher(getDb(), id, {
      balancePence: str(form, 'balance') ? poundsToPence(str(form, 'balance')) : undefined,
      expiresOn: str(form, 'expiresOn') || undefined,
      notes: str(form, 'notes'),
    });
  } catch (error) {
    back(`/admin/vouchers/${id}`, { error: errorText(error) });
  }
  revalidatePath(`/admin/vouchers/${id}`);
  back(`/admin/vouchers/${id}`, { ok: 'Voucher updated' });
}

export async function resendVoucherAction(form: FormData) {
  await requireAdmin();
  const id = str(form, 'voucherId');
  await notifyVoucherReady(getDb(), id);
  back(`/admin/vouchers/${id}`, { ok: 'Voucher emailed again' });
}

export async function cancelVoucherAction(form: FormData) {
  await requireAdmin();
  const id = str(form, 'voucherId');
  let message = 'Voucher cancelled';
  try {
    const refundPence = str(form, 'refund') ? poundsToPence(str(form, 'refund')) : 0;
    const result = await cancelVoucher(getDb(), id, { refundPence, refund: refundPayment });
    if (result.refundedPence > 0) message = `Voucher cancelled and £${(result.refundedPence / 100).toFixed(2)} refunded`;
  } catch (error) {
    back(`/admin/vouchers/${id}`, { error: errorText(error) });
  }
  revalidatePath(`/admin/vouchers/${id}`);
  back(`/admin/vouchers/${id}`, { ok: message });
}

// ---------------------------------------------------------------- importing clients

export type ImportState = { error?: string; ok?: string; preview?: { clients: { name: string; email: string; phone: string }[]; total: number; skipped: { line: number; reason: string }[]; columns: string[] } };

export async function importClientsAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  await requireAdmin();
  const text = String(form.get('csv') ?? '');
  if (!text.trim()) return { error: 'Choose the file exported from Bookwhen first.' };
  const result = readClients(text);
  if (!result.columns.length) return { error: "Couldn't find an email column in that file. Is it the client export from Bookwhen?" };
  if (!result.clients.length) return { error: 'No clients with email addresses were found in that file.' };
  if (form.get('mode') !== 'import') {
    return { preview: { clients: result.clients.slice(0, 10), total: result.clients.length, skipped: result.skipped.slice(0, 20), columns: result.columns } };
  }
  const { added, existing } = await importClients(getDb(), result.clients);
  revalidatePath('/admin/clients');
  return { ok: `Imported ${added} new ${added === 1 ? 'client' : 'clients'}${existing ? ` (${existing} already here, left as they were)` : ''}.` };
}
