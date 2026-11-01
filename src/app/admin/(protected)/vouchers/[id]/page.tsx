import Link from 'next/link';
import { notFound } from 'next/navigation';
import { inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { bookings, customerPasses, customers } from '@/db/schema';
import { formatPence } from '@/lib/money';
import { passEndText } from '@/lib/notify';
import { formatDayShort, londonDateKey } from '@/lib/time';
import { getVoucher } from '@/lib/vouchers';
import { Flash } from '@/components/Flash';
import { adjustVoucherAction, cancelVoucherAction, resendVoucherAction } from '@/app/admin/actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

const METHOD: Record<string, string> = { stripe: 'Card', cash: 'Cash', free: 'Free', manual: 'Other' };

export default async function AdminVoucherPage({ params, searchParams }: Props) {
  const { ok, error } = await searchParams;
  const db = getDb();
  const found = await getVoucher(db, (await params).id);
  if (!found) notFound();
  const { voucher: v, redemptions } = found;

  // Who spent it, from the bookings and passes it paid for
  const bookingIds = redemptions.map((r) => r.bookingId).filter((x): x is string => !!x);
  const passIds = redemptions.map((r) => r.passId).filter((x): x is string => !!x);
  const owners = new Map<string, { id: number; name: string }>();
  if (bookingIds.length) {
    for (const r of await db.select({ id: bookings.id, customerId: bookings.customerId }).from(bookings).where(inArray(bookings.id, bookingIds))) owners.set(r.id, { id: r.customerId, name: '' });
  }
  if (passIds.length) {
    for (const r of await db.select({ id: customerPasses.id, customerId: customerPasses.customerId }).from(customerPasses).where(inArray(customerPasses.id, passIds))) owners.set(r.id, { id: r.customerId, name: '' });
  }
  const customerIds = [...new Set([...owners.values()].map((o) => o.id))];
  const names = new Map((customerIds.length ? await db.select().from(customers).where(inArray(customers.id, customerIds)) : []).map((c) => [c.id, c.name]));

  return (
    <>
      <Flash ok={ok} error={error} />
      <p><Link href="/admin/vouchers">← All vouchers</Link></p>
      <section className="card">
        <p className="voucher-code" style={{ margin: 0 }}>{v.code}</p>
        <ul className="facts">
          <li><strong>Balance:</strong> {formatPence(v.balancePence)} of {formatPence(v.amountPence)}</li>
          <li><strong>Status:</strong> {v.status === 'active' ? (v.expiresAt && v.expiresAt <= new Date() ? 'Expired' : 'Active') : v.status}</li>
          {v.expiresAt && <li><strong>Use by:</strong> {passEndText(v.expiresAt, true)}</li>}
          <li><strong>From:</strong> {v.buyerName} (<a href={`mailto:${v.buyerEmail}`}>{v.buyerEmail}</a>) · {METHOD[v.paymentMethod] ?? v.paymentMethod}</li>
          {(v.recipientName || v.recipientEmail) && <li><strong>For:</strong> {v.recipientName} {v.recipientEmail && `(${v.recipientEmail})`}</li>}
          {v.message && <li><strong>Message:</strong> “{v.message}”</li>}
          {v.notes && <li><strong>Note:</strong> {v.notes}</li>}
          <li><strong>Created:</strong> {formatDayShort(v.createdAt)} {v.createdAt.getUTCFullYear()}</li>
        </ul>
      </section>

      <section className="card soft">
        <h2>Spent</h2>
        {redemptions.length === 0 ? (
          <p className="muted">Not used yet.</p>
        ) : (
          <table className="table">
            <tbody>
              {redemptions.map((r) => {
                const owner = owners.get(r.bookingId ?? r.passId ?? '');
                return (
                  <tr key={r.id} style={{ opacity: r.reversedAt ? 0.5 : 1 }}>
                    <td>{formatDayShort(r.createdAt)}</td>
                    <td>{formatPence(r.amountPence)}{r.reversedAt ? ' · given back' : ''}</td>
                    <td>
                      {r.passId ? 'Pass' : 'Booking'}
                      {owner && <> · <Link href={`/admin/clients/${owner.id}`}>{names.get(owner.id) ?? 'Client'}</Link></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {v.status === 'active' && (
        <>
          <details className="panel">
            <summary>Change balance or date</summary>
            <div>
              <form action={adjustVoucherAction}>
                <input type="hidden" name="voucherId" value={v.id} />
                <div className="grid-2">
                  <label>Balance £<input type="text" name="balance" inputMode="decimal" defaultValue={(v.balancePence / 100).toFixed(2)} /></label>
                  <label>Last day it can be used<input type="date" name="expiresOn" defaultValue={v.expiresAt ? londonDateKey(new Date(v.expiresAt.getTime() - 60000)) : ''} /></label>
                </div>
                <label>Private note<input type="text" name="notes" defaultValue={v.notes} /></label>
                <button className="btn" type="submit">Save</button>
              </form>
            </div>
          </details>
          <details className="panel">
            <summary>Email it again</summary>
            <div>
              <form action={resendVoucherAction}>
                <input type="hidden" name="voucherId" value={v.id} />
                <p className="muted">Sends the voucher to {v.buyerEmail}{v.recipientEmail ? ` and ${v.recipientEmail}` : ''}.</p>
                <button className="btn" type="submit">Resend voucher</button>
              </form>
            </div>
          </details>
          <details className="panel">
            <summary>Cancel voucher</summary>
            <div>
              <form action={cancelVoucherAction}>
                <input type="hidden" name="voucherId" value={v.id} />
                {v.paymentMethod === 'stripe' && (
                  <label>Refund to card £ (optional, up to {formatPence(v.amountPence)})<input type="text" name="refund" inputMode="decimal" /></label>
                )}
                <p className="muted">The code will stop working. Anything already booked with it stays booked.</p>
                <button className="btn danger" type="submit">Cancel voucher</button>
              </form>
            </div>
          </details>
        </>
      )}
    </>
  );
}
