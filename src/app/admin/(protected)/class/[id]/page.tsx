import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, gt, ne } from 'drizzle-orm';
import { getDb } from '@/db';
import { locations, sessions as sessionsTable } from '@/db/schema';
import { getSession, register } from '@/lib/booking';
import { formatPence } from '@/lib/money';
import { formatDay, formatDayShort, formatTime, formatTimeRange } from '@/lib/time';
import { Flash } from '@/components/Flash';
import {
  addBookingAction,
  attendedAction,
  cancelBookingAction,
  cancelSessionAction,
  moveBookingAction,
  updateSessionAction,
} from '@/app/admin/actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

const METHOD: Record<string, string> = { stripe: 'Card', cash: 'Cash', free: 'Free', manual: 'Manual' };

export default async function AdminClassPage({ params, searchParams }: Props) {
  const id = Number((await params).id);
  const { ok, error } = await searchParams;
  const db = getDb();
  const item = await getSession(db, id);
  if (!item) notFound();
  const { session, classType, location, course, taken } = item;
  const people = await register(db, id);
  const venues = await db.select().from(locations);
  // Other upcoming classes of the same type, for moving someone
  const others = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.classTypeId, session.classTypeId), ne(sessionsTable.id, id), gt(sessionsTable.startsAt, new Date()), eq(sessionsTable.status, 'scheduled')))
    .orderBy(sessionsTable.startsAt)
    .limit(12);
  const cancelled = session.status === 'cancelled';

  return (
    <>
      <Flash ok={ok} error={error} />
      <p><Link href="/admin">← All classes</Link></p>
      <section className="card">
        <h1>{classType.name}</h1>
        <ul className="facts">
          <li><strong>When:</strong> {formatDay(session.startsAt)}, {formatTimeRange(session.startsAt, session.endsAt)}</li>
          <li><strong>Where:</strong> {location?.name ?? 'Not set'}</li>
          {course && <li><strong>Course:</strong> {course.name}</li>}
          <li><strong>Booked:</strong> {taken} of {session.capacity}{session.pricePence !== null ? ` · ${formatPence(session.pricePence)} each` : ''}</li>
          {cancelled && <li className="full">This class is cancelled.</li>}
        </ul>
      </section>

      <section className="card soft">
        <h2>Register ({people.length})</h2>
        {people.length === 0 ? (
          <p className="muted">Nobody booked yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Here</th>
                <th>Name</th>
                <th className="hide-sm">Contact</th>
                <th>Paid</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map(({ registration, booking, customer }) => (
                <tr key={registration.id}>
                  <td>
                    <form action={attendedAction}>
                      <input type="hidden" name="sessionId" value={id} />
                      <input type="hidden" name="registrationId" value={registration.id} />
                      <input type="hidden" name="attended" value={registration.attended ? 'false' : 'true'} />
                      <button className="btn small" type="submit" aria-label={registration.attended ? 'Mark as not here' : 'Mark as here'}>
                        {registration.attended ? '✓' : '○'}
                      </button>
                    </form>
                  </td>
                  <td>
                    <strong>{customer.name}</strong>
                    {booking.kind === 'course' && <div className="muted">Course booking</div>}
                    {booking.notes && <div className="muted">{booking.notes}</div>}
                  </td>
                  <td className="hide-sm">
                    <a href={`mailto:${customer.email}`}>{customer.email}</a>
                    {customer.phone && <div><a href={`tel:${customer.phone}`}>{customer.phone}</a></div>}
                  </td>
                  <td>
                    {formatPence(booking.amountPence)} <span className="muted">{METHOD[booking.paymentMethod] ?? ''}</span>
                  </td>
                  <td>
                    <details>
                      <summary className="muted" style={{ cursor: 'pointer' }}>Manage</summary>
                      {others.length > 0 && (
                        <form action={moveBookingAction} style={{ marginTop: 10 }}>
                          <input type="hidden" name="sessionId" value={id} />
                          <input type="hidden" name="registrationId" value={registration.id} />
                          <label>
                            Move to
                            <select name="toSessionId">
                              {others.map((o) => (
                                <option key={o.id} value={o.id}>{formatDayShort(o.startsAt)} {formatTime(o.startsAt)}</option>
                              ))}
                            </select>
                          </label>
                          <button className="btn small" type="submit">Move</button>
                        </form>
                      )}
                      <form action={cancelBookingAction} style={{ marginTop: 10 }}>
                        <input type="hidden" name="sessionId" value={id} />
                        <input type="hidden" name="bookingId" value={booking.id} />
                        {booking.paymentMethod === 'stripe' && (
                          <label className="check"><input type="checkbox" name="refund" defaultChecked /> Refund {formatPence(booking.amountPence - booking.refundedPence)} to card</label>
                        )}
                        <label className="check"><input type="checkbox" name="notify" defaultChecked /> Email them</label>
                        {booking.kind === 'course' && <p className="muted">This cancels their whole course booking.</p>}
                        <button className="btn small danger" type="submit">Cancel booking</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {!cancelled && (
        <>
          <details className="panel">
            <summary>Add someone</summary>
            <div>
              <form action={addBookingAction}>
                <input type="hidden" name="sessionId" value={id} />
                <label>Name<input type="text" name="name" required /></label>
                <div className="grid-2">
                  <label>Email<input type="email" name="email" required /></label>
                  <label>Mobile<input type="tel" name="phone" /></label>
                </div>
                <div className="grid-2">
                  <label>
                    How they paid
                    <select name="method" defaultValue="cash">
                      <option value="cash">Cash / bank transfer</option>
                      <option value="free">Free (gift, prize, make-up)</option>
                      <option value="manual">Other</option>
                    </select>
                  </label>
                  <label>Amount £ (optional)<input type="text" name="amount" inputMode="decimal" /></label>
                </div>
                <label>Note (optional)<input type="text" name="notes" /></label>
                <label className="check"><input type="checkbox" name="notify" defaultChecked /> Send them a confirmation email</label>
                <button className="btn navy" type="submit">Add to class</button>
              </form>
            </div>
          </details>

          <details className="panel">
            <summary>Edit class</summary>
            <div>
              <form action={updateSessionAction}>
                <input type="hidden" name="sessionId" value={id} />
                <div className="grid-2">
                  <label>Spaces<input type="number" name="capacity" min={1} defaultValue={session.capacity} required /></label>
                  <label>
                    Venue
                    <select name="locationId" defaultValue={session.locationId ?? ''}>
                      <option value="">Not set</option>
                      {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </label>
                </div>
                <label>Note shown to clients (optional)<input type="text" name="notes" defaultValue={session.notes} /></label>
                <button className="btn" type="submit">Save</button>
              </form>
            </div>
          </details>

          <details className="panel">
            <summary>Cancel this class</summary>
            <div>
              <p>Everyone booked will be emailed. Pay-as-you-go bookings are refunded in full; course bookings keep their other sessions, so you can offer a make-up session.</p>
              <form action={cancelSessionAction}>
                <input type="hidden" name="sessionId" value={id} />
                <button className="btn danger" type="submit">Cancel class and refund</button>
              </form>
            </div>
          </details>
        </>
      )}
    </>
  );
}
