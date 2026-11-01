import type { Metadata } from 'next';
import { PASS_POLICY, REFUND_POLICY, VOUCHER_POLICY } from '@/lib/policy';

export const metadata: Metadata = { title: 'Booking & refund policy' };

export default function PoliciesPage() {
  return (
    <>
      <section className="hero">
        <h1>Booking policy</h1>
      </section>
      <article className="card">
        <h2>Refunds and cancellations</h2>
        <ul>
          {REFUND_POLICY.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>
          You can cancel using the link in your confirmation email, or from your account. Eligible refunds go back to your card automatically, and anything
          paid by gift voucher goes back on the voucher.
        </p>
        <h2>Passes</h2>
        <p>{PASS_POLICY}</p>
        <h2>Gift vouchers</h2>
        <p>{VOUCHER_POLICY}</p>
        <h2>Courses</h2>
        <p>
          Missed course sessions can't be refunded or transferred, but you're welcome to attend another class within the course if there's space. Just
          ask Lara.
        </p>
        <h2>Questions?</h2>
        <p>
          Email <a href="mailto:hello@eirandwild.co.uk">hello@eirandwild.co.uk</a> or WhatsApp Lara on 07885 899947.
        </p>
      </article>
    </>
  );
}
