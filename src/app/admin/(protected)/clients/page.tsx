import Link from 'next/link';
import { getDb } from '@/db';
import { searchCustomers } from '@/lib/passes';
import { Flash } from '@/components/Flash';
import { addClientAction } from '@/app/admin/actions';

type Props = { searchParams: Promise<{ q?: string; ok?: string; error?: string }> };

export default async function AdminClientsPage({ searchParams }: Props) {
  const { q = '', ok, error } = await searchParams;
  const clients = await searchCustomers(getDb(), q);
  return (
    <>
      <Flash ok={ok} error={error} />
      <h1>Clients</h1>
      <form method="get" className="row-actions" style={{ marginBottom: 16 }}>
        <input type="search" name="q" defaultValue={q} placeholder="Search by name, email or phone" aria-label="Search clients" style={{ flex: 1 }} />
        <button className="btn small navy" type="submit">Search</button>
      </form>
      <section className="card soft">
        {!q && <p className="muted">Newest clients first.</p>}
        {clients.length === 0 && <p className="muted">No clients found.</p>}
        <table className="table">
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/admin/clients/${c.id}`}><strong>{c.name}</strong></Link></td>
                <td className="hide-sm">{c.email}</td>
                <td className="hide-sm">{c.phone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <details className="panel">
        <summary>Add a client</summary>
        <div>
          <form action={addClientAction}>
            <label>Name<input type="text" name="name" required /></label>
            <div className="grid-2">
              <label>Email<input type="email" name="email" required /></label>
              <label>Mobile<input type="tel" name="phone" /></label>
            </div>
            <button className="btn navy" type="submit">Save client</button>
          </form>
        </div>
      </details>
    </>
  );
}
