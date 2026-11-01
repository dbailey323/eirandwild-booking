import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@/db';
import { passEndText } from '@/lib/notify';
import { getPassDetail } from '@/lib/passes';
import { creditsText } from '@/lib/passText';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your pass', robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

// Where Stripe sends people after paying for a pass. The id is a random UUID.
export default async function PassDonePage({ params }: Props) {
  const detail = await getPassDetail(getDb(), (await params).id);
  if (!detail) notFound();
  const { pass, type, customer } = detail;
  const waiting = pass.status === 'pending';
  return (
    <>
      {waiting && <meta httpEquiv="refresh" content="3" />}
      <section className="hero">
        <h1>{waiting ? 'Almost there' : pass.status === 'active' ? 'Your pass is ready!' : 'Pass not active'}</h1>
        <p>
          {waiting && 'Payment received. Setting up your pass…'}
          {pass.status === 'active' && `Thank you, ${customer.name}. We've emailed the details to ${customer.email}.`}
          {(pass.status === 'expired' || pass.status === 'cancelled') && 'This pass is not active. If you think this is wrong, please contact Lara.'}
        </p>
      </section>
      <article className="card">
        <h2>{type.name}</h2>
        <ul className="facts">
          <li><strong>Covers:</strong> {creditsText(pass.creditsTotal)}</li>
          {pass.expiresAt && <li><strong>Use by:</strong> {passEndText(pass.expiresAt)}</li>}
        </ul>
        {pass.status === 'active' && (
          <p style={{ marginBottom: 0 }}>
            To book with your pass, sign in with <strong>{customer.email}</strong> and choose <strong>Book with my pass</strong> on a class.
          </p>
        )}
      </article>
      <p>
        <Link className="btn navy" href="/account">Go to your account</Link> <Link className="btn" href="/">See the timetable</Link>
      </p>
    </>
  );
}
