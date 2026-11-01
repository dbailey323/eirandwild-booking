import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@/db';
import { classTypes } from '@/db/schema';
import { requireClient } from '@/lib/clientAuth';
import { formatPence } from '@/lib/money';
import { passEndText } from '@/lib/notify';
import { customerBookings, customerPassList } from '@/lib/passes';
import { PASS_STATE_LABEL, creditsText, listNames } from '@/lib/passText';
import { formatDay, formatTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your account', robots: { index: false } };

export default async function AccountPage() {
  const db = getDb();
  const customer = await requireClient(db);
  const now = new Date();
  const [passes, rows, types] = await Promise.all([customerPassList(db, customer.id, now), customerBookings(db, customer.id), db.select().from(classTypes)]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const live = rows.filter((r) => r.booking.status === 'confirmed' && r.registration.status === 'active');
  const upcoming = live.filter((r) => r.session.startsAt > now).reverse();
  const past = live.filter((r) => r.session.startsAt <= now).slice(0, 10);
  const currentPasses = passes.filter((p) => p.usable);
  const oldPasses = passes.filter((p) => !p.usable).slice(0, 5);

  return (
    <>
      <section className="hero">
        <h1>Hi {customer.name}</h1>
        <p>Signed in as {customer.email}</p>
      </section>

      <section className="card">
        <h2>Your passes</h2>
        {currentPasses.length === 0 && <p className="muted">You don't have a pass at the moment.</p>}
        {currentPasses.map(({ pass, type, creditsLeft, classTypeIds, state }) => (
          <div key={pass.id} className="pass">
            <div className="pass-head">
              <strong>{type.name}</strong>
              <span className="pass-left">{creditsLeft === null ? 'Unlimited' : `${creditsLeft} of ${pass.creditsTotal} left`}</span>
            </div>
            <div className="muted">
              {listNames(classTypeIds.map((id) => typeName.get(id) ?? '').filter(Boolean))}
              {pass.expiresAt && ` · use by ${passEndText(pass.expiresAt)}`}
              {state === 'not_started' && pass.startsAt && ` · starts ${formatDay(pass.startsAt)}`}
            </div>
          </div>
        ))}
        <div className="row-actions" style={{ marginTop: 16 }}>
          <Link className="btn" href="/passes">Buy a pass</Link>
          {currentPasses.length > 0 && <Link className="btn navy" href="/">Book a class</Link>}
        </div>
      </section>

      <section className="card">
        <h2>Upcoming classes</h2>
        {upcoming.length === 0 ? (
          <p className="muted">Nothing booked yet. <Link href="/">See the timetable</Link>.</p>
        ) : (
          <ul className="dates">
            {upcoming.map((r) => (
              <li key={r.registration.id}>
                <strong>{r.classType.name}</strong>, {formatDay(r.session.startsAt)} at {formatTime(r.session.startsAt)}
                {r.session.status === 'cancelled' && ' · CANCELLED'} · <Link href={`/booking/${r.booking.manageToken}`}>View or cancel</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="card">
          <h2>Recent classes</h2>
          <ul className="dates">
            {past.map((r) => (
              <li key={r.registration.id}>{r.classType.name}, {formatDay(r.session.startsAt)}</li>
            ))}
          </ul>
        </section>
      )}

      {oldPasses.length > 0 && (
        <section className="card">
          <h2>Old passes</h2>
          <ul className="dates">
            {oldPasses.map(({ pass, type, state }) => (
              <li key={pass.id}>
                {type.name} · {creditsText(pass.creditsTotal)} · {PASS_STATE_LABEL[state]}
                {pass.amountPence > 0 && ` · ${formatPence(pass.amountPence)}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action="/account/logout" method="post">
        <button className="btn small" type="submit">Sign out</button>
      </form>
    </>
  );
}
