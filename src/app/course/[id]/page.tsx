import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@/db';
import { getCourse } from '@/lib/booking';
import { groupLabel } from '@/lib/groups';
import { formatPence } from '@/lib/money';
import { COURSE_CANCEL_HOURS } from '@/lib/policy';
import { formatDay, formatTimeRange } from '@/lib/time';
import { BookingForm } from '@/components/BookingForm';
import { bookCourse, joinWaitlistAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const course = await getCourse(getDb(), Number((await params).id));
  return { title: course?.course.name ?? 'Course' };
}

export default async function CoursePage({ params }: Props) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const detail = await getCourse(getDb(), id);
  if (!detail) notFound();
  const { course, classType, location, sessions, remaining, pricePence, spacesLeft, bookable, reason } = detail;
  const now = new Date();
  const proRataNote = course.proRata && remaining.length < sessions.length;

  return (
    <>
      <p style={{ margin: '20px 0 0' }}><Link href="/">← All classes</Link></p>
      <article className="card">
        <p className="muted" style={{ margin: 0 }}>{groupLabel(classType.group)} · {sessions.length}-week course</p>
        <h1>{course.name}</h1>
        <ul className="facts">
          {location && <li><strong>Where:</strong> {location.online ? 'Online via Zoom' : `${location.name}${location.address ? `, ${location.address}` : ''}`}</li>}
          <li>
            <strong>Price:</strong> <span className="price">{formatPence(pricePence)}</span>
            {proRataNote && <span className="muted"> for the {remaining.length} sessions left</span>}
          </li>
          {bookable && <li><strong>Spaces:</strong> {spacesLeft <= 3 ? <span className="low">{spacesLeft} left</span> : 'Available'}</li>}
        </ul>
        <h2 style={{ fontSize: '1.05rem' }}>Course dates</h2>
        <ul className="dates">
          {sessions.map((s) => (
            <li key={s.id} style={{ color: s.startsAt <= now ? '#999' : undefined }}>
              {formatDay(s.startsAt)}, {formatTimeRange(s.startsAt, s.endsAt)}
              {s.startsAt <= now ? ' (done)' : ''}
            </li>
          ))}
        </ul>
        {classType.description && <p>{classType.description}</p>}
      </article>

      {bookable ? (
        <section className="card soft">
          <h2>Book the course</h2>
          <p className="muted">
            One booking covers every session. You'll pay securely by card on the next page. Free cancellation up to {COURSE_CANCEL_HOURS} hours before the course starts.
          </p>
          <BookingForm action={bookCourse} withVoucher hidden={{ courseId: course.id }} submitLabel={`Continue to payment · ${formatPence(pricePence)}`} />
        </section>
      ) : spacesLeft === 0 && remaining.length > 0 ? (
        <section className="card soft">
          <h2>Join the waiting list</h2>
          <p className="muted">{reason} Leave your details and we'll email you if a space opens up.</p>
          <BookingForm action={joinWaitlistAction} hidden={{ courseId: course.id }} submitLabel="Join waiting list" withPolicy={false} />
        </section>
      ) : (
        <p className="alert info">{reason} <Link href="/">See upcoming classes</Link>.</p>
      )}
    </>
  );
}
