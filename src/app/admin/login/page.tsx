import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Admin sign in', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <section className="hero">
        <h1>Admin</h1>
        <p>Enter your email and we'll send you a sign-in link.</p>
      </section>
      <div className="card">
        {error && <p className="alert error">That sign-in link has expired or already been used. Please ask for a new one.</p>}
        <LoginForm />
      </div>
    </>
  );
}
