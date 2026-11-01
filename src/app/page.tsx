import Link from 'next/link';
import { getDb } from '@/db';
import { listCourses, listSessions, type ScheduleItem } from '@/lib/booking';
import { GROUPS } from '@/lib/groups';
import { formatPence } from '@/lib/money';
import { addLondonDays, formatDay, formatDayShort, formatTime, londonDateKey } from '@/lib/time';

export const dynamic = 'force-dynamic';

const WEEKS = 8;

function spacesLabel(item: ScheduleItem) {
  if (item.spacesLeft === 0) return <span className="full">Full: join waiting list</span>;
  if (item.spacesLeft <= 3) return <span className="low">{item.spacesLeft} {item.spacesLeft === 1 ? 'space' : 'spaces'} left</span>;
  return <span>Book</span>;
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group } = await searchParams;
  const activeGroup = group && GROUPS[group] ? group : undefined;
  const db = getDb();
  const now = new Date();
  const items = await listSessions(db, { from: now, to: addLondonDays(now, WEEKS * 7), group: activeGroup });
  const courses = (await listCourses(db)).filter((c) => !activeGroup || c.classType.group === activeGroup);

  // Sessions that only exist as part of a course are booked from the course page
  const days = new Map<string, ScheduleItem[]>();
  for (const item of items) {
    const key = londonDateKey(item.session.startsAt);
    if (!days.has(key)) days.set(key, []);
    days.get(key)!.push(item);
  }

  return (
    <>
      <section className="hero">
        <h1>Book a class</h1>
        <p>Choose a class below to book your space. Spaces are limited, so pre-booking is recommended.</p>
      </section>

      <nav className="chips" aria-label="Filter classes">
        <Link className="chip" href="/" aria-current={!activeGroup}>All classes</Link>
        {Object.entries(GROUPS).map(([key, g]) => (
          <Link key={key} className="chip" href={`/?group=${key}`} aria-current={activeGroup === key}>{g.label}</Link>
        ))}
      </nav>

      {courses.length > 0 && (
        <section className="day">
          <h2>Courses</h2>
          {courses.map((c) => (
            <Link key={c.course.id} className="slot" href={`/course/${c.course.id}`} style={{ borderLeftColor: GROUPS[c.classType.group]?.colour }}>
              <span className="slot-time">From {formatDayShort(c.remaining[0].startsAt)}</span>
              <span>
                <span className="slot-title">{c.course.name}</span>
                <span className="slot-meta">
                  {c.remaining.length} sessions · {formatPence(c.pricePence)}
                  {c.location ? ` · ${c.location.name}` : ''}
                </span>
              </span>
              <span className="slot-action">
                {c.bookable ? (c.spacesLeft <= 3 ? <span className="low">{c.spacesLeft} left</span> : 'Book') : <span className="full">{c.spacesLeft === 0 ? 'Full' : 'Closed'}</span>}
              </span>
            </Link>
          ))}
        </section>
      )}

      {days.size === 0 && <p className="alert info">No classes are scheduled just yet. Please check back soon!</p>}

      {[...days.entries()].map(([key, dayItems]) => (
        <section className="day" key={key}>
          <h2>{formatDay(dayItems[0].session.startsAt)}</h2>
          {dayItems.map((item) => {
            const courseOnly = item.session.pricePence === null && item.course;
            return (
              <Link
                key={item.session.id}
                className="slot"
                href={courseOnly ? `/course/${item.course!.id}` : `/class/${item.session.id}`}
                style={{ borderLeftColor: GROUPS[item.classType.group]?.colour }}
              >
                <span className="slot-time">{formatTime(item.session.startsAt)}</span>
                <span>
                  <span className="slot-title">{item.classType.name}</span>
                  <span className="slot-meta">
                    {item.location ? item.location.name : ''}
                    {courseOnly ? ' · Part of a course' : item.session.pricePence !== null ? ` · ${formatPence(item.session.pricePence)}` : ''}
                  </span>
                </span>
                <span className="slot-action">{courseOnly ? 'View course' : spacesLabel(item)}</span>
              </Link>
            );
          })}
        </section>
      ))}
    </>
  );
}
