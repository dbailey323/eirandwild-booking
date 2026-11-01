import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { classTypes } from '@/db/schema';
import { buyPass } from '@/app/account/actions';
import { BookingForm } from '@/components/BookingForm';
import { currentClient } from '@/lib/clientAuth';
import { formatPence } from '@/lib/money';
import { listPassTypes } from '@/lib/passes';
import { PASS_POLICY } from '@/lib/policy';
import { listNames, passSummary } from '@/lib/passText';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

async function load(id: number) {
  return (await listPassTypes(getDb(), { onSaleOnly: true })).find((t) => t.id === id) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const type = await load(Number((await params).id));
  return { title: type?.name ?? 'Pass' };
}

export default async function PassPage({ params }: Props) {
  const db = getDb();
  const type = await load(Number((await params).id));
  if (!type) notFound();
  const [classes, client] = await Promise.all([
    db.select().from(classTypes).where(inArray(classTypes.id, type.classTypeIds)),
    currentClient(db),
  ]);
  return (
    <>
      <p style={{ margin: '20px 0 0' }}><Link href="/passes">← All passes</Link></p>
      <article className="card">
        <h1>{type.name}</h1>
        <ul className="facts">
          <li><strong>Covers:</strong> {passSummary(type)}</li>
          <li><strong>For:</strong> {listNames(classes.map((c) => c.name))}</li>
          <li><strong>Price:</strong> <span className="price">{formatPence(type.pricePence)}</span></li>
        </ul>
        {type.description && <p>{type.description}</p>}
        <p className="muted">{PASS_POLICY} Classes booked with a pass go back on it if you cancel at least 4 hours before.</p>
      </article>
      <section className="card soft">
        <h2>Buy this pass</h2>
        {client && <p className="muted">Signed in as {client.email}.</p>}
        <BookingForm
          action={buyPass}
          hidden={{ passTypeId: type.id }}
          defaults={client ? { name: client.name, email: client.email, phone: client.phone } : {}}
          submitLabel={type.pricePence > 0 ? `Continue to payment · ${formatPence(type.pricePence)}` : 'Get this pass'}
          policy={<>I agree to the pass terms and the <Link href="/policies" target="_blank">booking and refund policy</Link>.</>}
        />
      </section>
    </>
  );
}
