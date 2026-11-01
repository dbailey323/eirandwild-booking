import Link from 'next/link';
import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin', robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const email = await requireAdmin();
  return (
    <>
      <nav className="admin-nav" aria-label="Admin">
        <Link className="btn small navy" href="/admin">Classes</Link>
        <Link className="btn small" href="/admin/new">Add classes</Link>
        <Link className="btn small" href="/admin/clients">Clients</Link>
        <Link className="btn small" href="/admin/passes">Passes</Link>
        <Link className="btn small" href="/" target="_blank">View booking site</Link>
        <form action="/admin/logout" method="post" style={{ marginLeft: 'auto' }}>
          <button className="btn small danger" type="submit" title={email}>Sign out</button>
        </form>
      </nav>
      {children}
    </>
  );
}
