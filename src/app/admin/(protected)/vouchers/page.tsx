import Link from 'next/link';
import { getDb } from '@/db';
import { formatPence } from '@/lib/money';
import { passEndText } from '@/lib/notify';
import { listVouchers } from '@/lib/vouchers';
import { Flash } from '@/components/Flash';
import { grantVoucherAction } from '@/app/admin/actions';

type Props = { searchParams: Promise<{ q?: string; ok?: string; error?: string }> };

export default async function AdminVouchersPage({ searchParams }: Props) {
  const { q = '', ok, error } = await searchParams;
  const vouchers = await listVouchers(getDb(), q);
  const now = new Date();
  const label = (v: (typeof vouchers)[number]) => {
    if (v.status === 'cancelled') return 'Cancelled';
    if (v.status !== 'active') return v.status === 'pending' ? 'Awaiting payment' : 'Not paid';
    if (v.expiresAt && v.expiresAt <= now) return 'Expired';
    if (v.balancePence === 0) return 'Used';
    return `Use by ${passEndText(v.expiresAt, true)}`;
  };
  return (
    <>
      <Flash ok={ok} error={error} />
      <h1>Gift vouchers</h1>
      <p className="muted">Vouchers bought at <Link href="/gift" target="_blank">/gift</Link>, or created here. Clients enter the code when booking.</p>
      <form method="get" className="row-actions" style={{ marginBottom: 16 }}>
        <input type="search" name="q" defaultValue={q} placeholder="Search by code, buyer or recipient" aria-label="Search vouchers" style={{ flex: 1 }} />
        <button className="btn small navy" type="submit">Search</button>
      </form>
      <section className="card soft">
        {vouchers.length === 0 && <p className="muted">No vouchers found.</p>}
        <table className="table">
          <tbody>
            {vouchers.map((v) => (
              <tr key={v.id} style={{ opacity: v.status === 'active' && v.balancePence > 0 ? 1 : 0.6 }}>
                <td><Link href={`/admin/vouchers/${v.id}`}><strong>{v.code}</strong></Link></td>
                <td>{formatPence(v.balancePence)} <span className="muted">of {formatPence(v.amountPence)}</span></td>
                <td className="hide-sm">{v.recipientName || v.buyerName}</td>
                <td className="hide-sm muted">{label(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <details className="panel">
        <summary>Create a voucher</summary>
        <div>
          <p className="muted">For a prize, a raffle, or a voucher someone paid for by cash or bank transfer. It lasts 12 months.</p>
          <form action={grantVoucherAction}>
            <div className="grid-2">
              <label>Amount £<input type="text" name="amount" inputMode="decimal" required /></label>
              <label>
                How it was paid
                <select name="method" defaultValue="free">
                  <option value="free">Free (prize or gift)</option>
                  <option value="cash">Cash / bank transfer</option>
                  <option value="manual">Other</option>
                </select>
              </label>
            </div>
            <div className="grid-2">
              <label>From (name)<input type="text" name="buyerName" defaultValue="Eir & Wild" required /></label>
              <label>Send the voucher to (email)<input type="email" name="buyerEmail" required /></label>
            </div>
            <div className="grid-2">
              <label>For (name, optional)<input type="text" name="recipientName" /></label>
              <label>Also email it to (optional)<input type="email" name="recipientEmail" /></label>
            </div>
            <label>Message (optional)<input type="text" name="message" maxLength={500} /></label>
            <label>Private note (optional)<input type="text" name="notes" placeholder="e.g. School summer fair raffle" /></label>
            <label className="check"><input type="checkbox" name="notify" defaultChecked /> Email the voucher now</label>
            <button className="btn navy" type="submit">Create voucher</button>
          </form>
        </div>
      </details>
    </>
  );
}
