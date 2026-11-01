import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { classTypes, customers } from '@/db/schema';
import { formatPence } from '@/lib/money';
import { passEndText } from '@/lib/notify';
import { customerBookings, customerPassList, listPassTypes } from '@/lib/passes';
import { PASS_STATE_LABEL, listNames, passSummary } from '@/lib/passText';
import { formatDayShort, formatTime, londonDateKey } from '@/lib/time';
import { Flash } from '@/components/Flash';
import { adjustPassAction, cancelPassAction, grantPassAction, updateClientAction } from '@/app/admin/actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

const METHOD: Record<string, string> = { stripe: 'Card', cash: 'Cash', free: 'Free', manual: 'Manual', pass: 'Pass' };

export default async function AdminClientPage({ params, searchParams }: Props) {
  const id = Number((await params).id);
  const { ok, error } = await searchParams;
  const db = getDb();
  const [customer] = Number.isInteger(id) ? await db.select().from(customers).where(eq(customers.id, id)) : [];
  if (!customer) notFound();
  const now = new Date();
  const [passes, rows, types, classes] = await Promise.all([
    customerPassList(db, id, now),
    customerBookings(db, id),
    listPassTypes(db),
    db.select().from(classTypes),
  ]);
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const upcoming = rows.filter((r) => r.session.startsAt > now).reverse();
  const past = rows.filter((r) => r.session.startsAt <= now).slice(0, 30);
  const attended = rows.filter((r) => r.registration.attended).length;

  const bookingRow = (r: (typeof rows)[number]) => {
    const live = r.booking.status === 'confirmed' && r.registration.status === 'active';
    return (
      <tr key={r.registration.id} style={{ opacity: live ? 1 : 0.5 }}>
        <td>{formatDayShort(r.session.startsAt)} {formatTime(r.session.startsAt)}</td>
        <td><Link href={`/admin/class/${r.session.id}`}>{r.classType.name}</Link>{!live && ' · cancelled'}{r.registration.attended && ' ✓'}</td>
        <td className="hide-sm">{r.booking.paymentMethod === 'pass' ? 'Pass' : `${formatPence(r.booking.amountPence)} ${METHOD[r.booking.paymentMethod] ?? ''}`}</td>
      </tr>
    );
  };

  return (
    <>
      <Flash ok={ok} error={error} />
      <p><Link href="/admin/clients">← All clients</Link></p>
      <section className="card">
        <h1>{customer.name}</h1>
        <ul className="facts">
          <li><strong>Email:</strong> <a href={`mailto:${customer.email}`}>{customer.email}</a></li>
          {customer.phone && <li><strong>Mobile:</strong> <a href={`tel:${customer.phone}`}>{customer.phone}</a></li>}
          <li><strong>Client since:</strong> {formatDayShort(customer.createdAt)} {customer.createdAt.getFullYear()}</li>
          <li><strong>Classes attended:</strong> {attended}</li>
        </ul>
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>Edit details</summary>
          <form action={updateClientAction} style={{ marginTop: 10 }}>
            <input type="hidden" name="customerId" value={id} />
            <div className="grid-2">
              <label>Name<input type="text" name="name" defaultValue={customer.name} required /></label>
              <label>Mobile<input type="tel" name="phone" defaultValue={customer.phone} /></label>
            </div>
            <button className="btn small" type="submit">Save</button>
          </form>
        </details>
      </section>

      <section className="card soft">
        <h2>Passes</h2>
        {passes.length === 0 && <p className="muted">No passes.</p>}
        {passes.map(({ pass, type, classTypeIds, creditsLeft, state }) => (
          <div key={pass.id} className="pass">
            <div className="pass-head">
              <strong>{type.name}</strong>
              <span className="pass-left">{creditsLeft === null ? 'Unlimited' : `${creditsLeft} of ${pass.creditsTotal} left`}</span>
            </div>
            <div className="muted">
              {PASS_STATE_LABEL[state]}
              {pass.expiresAt && ` · use by ${passEndText(pass.expiresAt)}`}
              {' · '}{pass.amountPence > 0 ? `${formatPence(pass.amountPence)} ${METHOD[pass.paymentMethod] ?? ''}` : 'Free'}
              {pass.refundedPence > 0 && ` (refunded ${formatPence(pass.refundedPence)})`}
              {' · '}{listNames(classTypeIds.map((c) => className.get(c) ?? '').filter(Boolean))}
            </div>
            {pass.notes && <div className="muted">{pass.notes}</div>}
            {pass.status === 'active' && (
              <details style={{ marginTop: 6 }}>
                <summary className="muted" style={{ cursor: 'pointer' }}>Change</summary>
                <form action={adjustPassAction} style={{ marginTop: 10 }}>
                  <input type="hidden" name="customerId" value={id} />
                  <input type="hidden" name="passId" value={pass.id} />
                  <div className="grid-2">
                    {pass.creditsTotal !== null && (
                      <label>Total classes (used {pass.creditsUsed})<input type="number" name="credits" min={0} defaultValue={pass.creditsTotal} /></label>
                    )}
                    <label>Last day it can be used<input type="date" name="expiresOn" defaultValue={pass.expiresAt ? londonDateKey(new Date(pass.expiresAt.getTime() - 60000)) : ''} /></label>
                  </div>
                  <label>Note<input type="text" name="notes" defaultValue={pass.notes} /></label>
                  <button className="btn small" type="submit">Save changes</button>
                </form>
                <form
                  action={cancelPassAction}
                  style={{ marginTop: 14 }}
                >
                  <input type="hidden" name="customerId" value={id} />
                  <input type="hidden" name="passId" value={pass.id} />
                  {pass.paymentMethod === 'stripe' && pass.amountPence > pass.refundedPence && (
                    <label>Refund to card £ (optional, up to {formatPence(pass.amountPence - pass.refundedPence)})<input type="text" name="refund" inputMode="decimal" /></label>
                  )}
                  <p className="muted">Classes already booked with this pass stay booked.</p>
                  <button className="btn small danger" type="submit">Cancel pass</button>
                </form>
              </details>
            )}
          </div>
        ))}
      </section>

      <details className="panel">
        <summary>Give {customer.name} a pass</summary>
        <div>
          <form action={grantPassAction}>
            <input type="hidden" name="customerId" value={id} />
            <label>
              Pass
              <select name="passTypeId" required>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({passSummary(t)}, {formatPence(t.pricePence)})</option>)}
              </select>
            </label>
            <div className="grid-2">
              <label>
                How they paid
                <select name="method" defaultValue="free">
                  <option value="free">Free (prize or gift)</option>
                  <option value="cash">Cash / bank transfer</option>
                  <option value="manual">Other</option>
                </select>
              </label>
              <label>Amount paid £ (optional)<input type="text" name="amount" inputMode="decimal" /></label>
            </div>
            <label>Note (optional)<input type="text" name="notes" placeholder="e.g. Facebook competition winner" /></label>
            <label className="check"><input type="checkbox" name="notify" defaultChecked /> Email them the pass details</label>
            <button className="btn navy" type="submit">Give pass</button>
          </form>
          {types.length === 0 && <p className="muted">Add a pass on the <Link href="/admin/passes">Passes</Link> page first.</p>}
        </div>
      </details>

      <section className="card soft">
        <h2>Upcoming classes</h2>
        {upcoming.length === 0 ? <p className="muted">None booked.</p> : <table className="table"><tbody>{upcoming.map(bookingRow)}</tbody></table>}
      </section>
      {past.length > 0 && (
        <section className="card soft">
          <h2>Past classes</h2>
          <table className="table"><tbody>{past.map(bookingRow)}</tbody></table>
        </section>
      )}
    </>
  );
}
