import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@/db';
import { getBookingByToken } from '@/lib/booking';
import { formatPence } from '@/lib/money';
import { formatDay, formatDayShort, formatTime, formatTimeRange } from '@/lib/time';
import { CancelForm } from '@/components/BookingForm';
import { cancelOwnBooking } from '@/app/actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your booking', robots: { index: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> };

export default async function BookingPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { paid } = await searchParams;
  const desc = await getBookingByToken(getDb(), token);
  if (!desc) notFound();
  const { booking, customer, sessions, title, firstStart, refundDeadline } = desc;
  const now = new Date();
  const started = firstStart ? firstStart <= now : false;
  const refundable = refundDeadline ? now <= refundDeadline : false;
  const byPass = booking.paymentMethod === 'pass';
  // Stripe tells us about the payment a moment after sending people back here
  const waitingForPayment = booking.status === 'pending' && paid === '1';

  return (
    <>
      {waitingForPayment && <meta httpEquiv="refresh" content="3" />}
      <section className="hero">
        <h1>{booking.status === 'confirmed' ? "You're booked!" : booking.status === 'pending' ? 'Almost there' : 'Booking cancelled'}</h1>
        <p>
          {booking.status === 'confirmed' && `Thank you, ${customer.name}. A confirmation has been sent to ${customer.email}.`}
          {waitingForPayment && 'Payment received. Confirming your booking…'}
          {booking.status === 'pending' && !waitingForPayment && 'This booking is waiting for payment.'}
          {(booking.status === 'cancelled' || booking.status === 'expired') && 'This booking is no longer active.'}
        </p>
      </section>

      <article className="card">
        <h2>{title}</h2>
        <ul className="dates">
          {sessions.map((s) => (
            <li key={s.registration.id} style={{ textDecoration: s.registration.status === 'cancelled' && booking.status === 'confirmed' ? 'line-through' : undefined }}>
              <strong>{formatDay(s.session.startsAt)}</strong>, {formatTimeRange(s.session.startsAt, s.session.endsAt)}
              {s.location ? ` · ${s.location.online ? 'Online via Zoom' : s.location.name}` : ''}
            </li>
          ))}
        </ul>
        <ul className="facts">
          <li><strong>Name:</strong> {customer.name}</li>
          {byPass ? (
            <li><strong>Paid with:</strong> your class pass</li>
          ) : (
            <li><strong>Amount:</strong> {formatPence(booking.amountPence)}{booking.refundedPence > 0 ? ` (refunded ${formatPence(booking.refundedPence)})` : ''}</li>
          )}
        </ul>
      </article>

      {booking.status === 'confirmed' && !started && refundDeadline && (
        <section className="card soft">
          <h2>Need to cancel?</h2>
          <p className="muted">
            {byPass
              ? refundable
                ? `If you cancel before ${formatDayShort(refundDeadline)} at ${formatTime(refundDeadline)}, the class goes back on your pass.`
                : "It's now less than 4 hours before the class, so the class won't go back on your pass. You can still cancel to free your space for someone else."
              : booking.amountPence === 0
                ? 'You can cancel at any time before the class to free your space for someone else.'
                : refundable
                  ? `You can cancel for a full refund until ${formatDayShort(refundDeadline)} at ${formatTime(refundDeadline)}.`
                  : 'The refund period has passed, so cancelling now will not be refunded. You can still cancel to free your space for someone else.'}
          </p>
          <CancelForm action={cancelOwnBooking} token={token} label={refundable && booking.amountPence > 0 ? 'Cancel and refund' : 'Cancel booking'} />
        </section>
      )}

      <p><Link className="btn" href="/">Book another class</Link> <Link className="btn" href="/account">Your account</Link></p>
    </>
  );
}
