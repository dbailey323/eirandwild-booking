import Link from 'next/link';
import { getDb } from '@/db';
import { listSessions } from '@/lib/booking';
import { groupLabel } from '@/lib/groups';
import { addLondonDays, formatDay, formatTime, londonDateKey } from '@/lib/time';
import { Flash } from '@/components/Flash';

type Props = { searchParams: Promise<{ ok?: string; error?: string; past?: string }> };

export default async function AdminHome({ searchParams }: Props) {
  const { ok, error, past } = await searchParams;
  const now = new Date();
  const showPast = past === '1';
  const items = await listSessions(getDb(), {
    from: showPast ? addLondonDays(now, -28) : addLondonDays(now, -1),
    to: showPast ? now : addLondonDays(now, 42),
    includeCancelled: true,
  });
  const days = new Map<string, typeof items>();
  for (const item of showPast ? [...items].reverse() : items) {
    const key = londonDateKey(item.session.startsAt);
    if (!days.has(key)) days.set(key, []);
    days.get(key)!.push(item);
  }

  return (
    <>
      <Flash ok={ok} error={error} />
      <h1>{showPast ? 'Past classes (last 4 weeks)' : 'Upcoming classes'}</h1>
      <p>
        <Link href={showPast ? '/admin' : '/admin?past=1'}>{showPast ? '← Upcoming classes' : 'See past classes →'}</Link>
      </p>
      {days.size === 0 && (
        <p className="alert info">
          No classes yet. <Link href="/admin/new">Add some classes</Link>.
        </p>
      )}
      {[...days.entries()].map(([key, dayItems]) => (
        <section className="day" key={key}>
          <h2>{formatDay(dayItems[0].session.startsAt)}</h2>
          {dayItems.map(({ session, classType, location, course, taken }) => (
            <Link key={session.id} className="slot" href={`/admin/class/${session.id}`} style={{ opacity: session.status === 'cancelled' ? 0.5 : 1 }}>
              <span className="slot-time">{formatTime(session.startsAt)}</span>
              <span>
                <span className="slot-title">{classType.name}</span>
                <span className="slot-meta">
                  {groupLabel(classType.group)}
                  {location ? ` · ${location.name}` : ''}
                  {course ? ` · ${course.name}` : ''}
                  {session.status === 'cancelled' ? ' · CANCELLED' : ''}
                </span>
              </span>
              <span className="slot-action">
                <span className={taken >= session.capacity ? 'full' : ''}>
                  {taken}/{session.capacity}
                </span>
              </span>
            </Link>
          ))}
        </section>
      ))}
    </>
  );
}
