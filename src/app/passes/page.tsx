import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@/db';
import { classTypes } from '@/db/schema';
import { formatPence } from '@/lib/money';
import { listPassTypes } from '@/lib/passes';
import { listNames, passSummary } from '@/lib/passText';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Class passes', description: 'Save on Eir & Wild classes with a class pass or term pass.' };

export default async function PassesPage() {
  const db = getDb();
  const [types, classes] = await Promise.all([listPassTypes(db, { onSaleOnly: true }), db.select().from(classTypes)]);
  const name = new Map(classes.map((c) => [c.id, c.name]));
  return (
    <>
      <section className="hero">
        <h1>Class passes</h1>
        <p>Buy classes in advance and save. Then book each class with your pass in a couple of taps.</p>
      </section>
      {types.length === 0 && <p className="alert info">There are no passes for sale right now.</p>}
      {types.map((t) => (
        <Link key={t.id} href={`/passes/${t.id}`} className="card pass-card">
          <span>
            <strong className="pass-name">{t.name}</strong>
            <span className="muted">{passSummary(t)}</span>
            <span className="muted">For {listNames(t.classTypeIds.map((id) => name.get(id) ?? '').filter(Boolean))}</span>
          </span>
          <span className="price">{formatPence(t.pricePence)}</span>
        </Link>
      ))}
      <p className="muted">Already have a pass? <Link href="/account">Sign in to your account</Link> to book with it.</p>
    </>
  );
}
