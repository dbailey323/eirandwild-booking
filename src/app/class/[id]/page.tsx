import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@/db';
import { getSession } from '@/lib/booking';
import { groupLabel } from '@/lib/groups';
import { formatPence } from '@/lib/money';
import { PAYG_CANCEL_HOURS } from '@/lib/policy';
import { formatDay, formatTimeRange } from '@/lib/time';
import { BookingForm } from '@/components/BookingForm';
import { bookSession, joinWaitlistAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await getSession(getDb(), Number((await params).id));
  return { title: item ? `${item.classType.name}, ${formatDay(item.session.startsAt)}` : 'Class' };
}

export default async function ClassPage({ params }: Props) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const item = await getSession(getDb(), id);
  if (!item) notFound();
  const { session, classType, location, course, spacesLeft } = item;
  const past = session.startsAt <= new Date();
  const cancelled = session.status !== 'scheduled';

  if (session.pricePence === null && course) {
    return (
      <div className="card">
        <h1>{classType.name}</h1>
        <p>This class is part of <strong>{course.name}</strong> and is booked as a full course.</p>
        <Link className="btn navy" href={`/course/${course.id}`}>View the course</Link>
      </div>
    );
  }

  return (
    <>
      <p style={{ margin: '20px 0 0' }}><Link href="/">← All classes</Link></p>
      <article className="card">
        <p className="muted" style={{ margin: 0 }}>{groupLabel(classType.group)}</p>
        <h1>{classType.name}</h1>
        <ul className="facts">
          <li><strong>When:</strong> {formatDay(session.startsAt)}, {formatTimeRange(session.startsAt, session.endsAt)}</li>
          {location && (
            <li>
              <strong>Where:</strong> {location.online ? 'Online via Zoom (link sent before the class)' : `${location.name}${location.address ? `, ${location.address}` : ''}`}
            </li>
          )}
          <li><strong>Price:</strong> <span className="price">{formatPence(session.pricePence ?? 0)}</span></li>
          {!past && !cancelled && (
            <li>
              <strong>Spaces:</strong>{' '}
              {spacesLeft === 0 ? <span className="full">Fully booked</span> : spacesLeft <= 3 ? <span className="low">{spacesLeft} left</span> : 'Available'}
            </li>
          )}
        </ul>
        {classType.description && <p>{classType.description}</p>}
        {session.notes && <p className="alert info">{session.notes}</p>}
      </article>

      {cancelled ? (
        <p className="alert error">Sorry, this class has been cancelled.</p>
      ) : past ? (
        <p className="alert info">This class has already started. <Link href="/">See upcoming classes</Link>.</p>
      ) : spacesLeft > 0 ? (
        <section className="card soft">
          <h2>Book your space</h2>
          <p className="muted">You'll pay securely by card on the next page. Free cancellation up to {PAYG_CANCEL_HOURS} hours before the class.</p>
          <BookingForm action={bookSession} hidden={{ sessionId: session.id }} submitLabel={`Continue to payment · ${formatPence(session.pricePence ?? 0)}`} />
        </section>
      ) : (
        <section className="card soft">
          <h2>Join the waiting list</h2>
          <p className="muted">This class is full. Leave your details and we'll email you if a space opens up.</p>
          <BookingForm action={joinWaitlistAction} hidden={{ sessionId: session.id }} submitLabel="Join waiting list" withPolicy={false} />
        </section>
      )}
    </>
  );
}
