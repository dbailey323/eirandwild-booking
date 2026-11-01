import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { currentClient } from '@/lib/clientAuth';
import { ClientLoginForm } from '@/components/ClientForms';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

type Props = { searchParams: Promise<{ error?: string; next?: string }> };

export default async function ClientLoginPage({ searchParams }: Props) {
  const { error, next: nextParam } = await searchParams;
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/account';
  if (await currentClient(getDb())) redirect(next);
  return (
    <>
      <section className="hero">
        <h1>Your account</h1>
        <p>See your bookings and passes, and book classes with your pass. No password needed: we'll email you a link.</p>
      </section>
      <div className="card">
        {error && <p className="alert error">That sign-in link has expired or already been used. Please ask for a new one.</p>}
        <ClientLoginForm next={next} />
        <p className="muted" style={{ marginBottom: 0 }}>Use the email address you booked with. Your account is set up automatically the first time you book or buy a pass.</p>
      </div>
    </>
  );
}
