import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@/db';
import { formatPence } from '@/lib/money';
import { passEndText } from '@/lib/notify';
import { getVoucher } from '@/lib/vouchers';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your gift voucher', robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

// Where Stripe sends people after paying for a voucher. The id is a random UUID.
export default async function VoucherDonePage({ params }: Props) {
  const found = await getVoucher(getDb(), (await params).id);
  if (!found) notFound();
  const { voucher } = found;
  const waiting = voucher.status === 'pending';
  const active = voucher.status === 'active';
  return (
    <>
      {waiting && <meta httpEquiv="refresh" content="3" />}
      <section className="hero">
        <h1>{active ? 'Thank you!' : waiting ? 'Almost there' : 'Voucher not active'}</h1>
        <p>
          {waiting && 'Payment received. Creating your voucher…'}
          {active && `Your gift voucher has been emailed to ${voucher.buyerEmail}${voucher.recipientEmail ? ` and ${voucher.recipientEmail}` : ''}.`}
          {!active && !waiting && 'If you think this is wrong, please contact Lara.'}
        </p>
      </section>
      {active && (
        <div className="voucher-card">
          <p className="muted" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: 2 }}>Gift voucher{voucher.recipientName ? ` for ${voucher.recipientName}` : ''}</p>
          <p className="price" style={{ margin: '4px 0 12px', fontSize: '2.4rem' }}>{formatPence(voucher.amountPence)}</p>
          <p style={{ margin: 0 }}>Code</p>
          <p className="voucher-code" style={{ margin: 0 }}>{voucher.code}</p>
          {voucher.expiresAt && <p className="muted" style={{ marginBottom: 0 }}>Use by {passEndText(voucher.expiresAt, true)}</p>}
        </div>
      )}
      <p><Link className="btn" href="/">See the timetable</Link></p>
    </>
  );
}
