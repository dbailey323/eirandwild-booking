'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import type { FormState } from '@/app/actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn navy" type="submit" disabled={pending}>
      {pending ? 'Please wait…' : label}
    </button>
  );
}

// Name, email and phone form used for bookings and the waiting list
export function BookingForm({
  action,
  hidden,
  submitLabel,
  withPolicy = true,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  hidden: Record<string, string | number>;
  submitLabel: string;
  withPolicy?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  if (state.ok) return <p className="alert ok">{state.ok}</p>;
  return (
    <form action={formAction}>
      {state.error && <p className="alert error" role="alert">{state.error}</p>}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label>
        Your name
        <input type="text" name="name" autoComplete="name" required />
      </label>
      <div className="grid-2">
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Mobile (optional)
          <input type="tel" name="phone" autoComplete="tel" />
        </label>
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }} />
      {withPolicy && (
        <label className="check">
          <input type="checkbox" name="agree" required />
          <span>
            I agree to the <Link href="/policies" target="_blank">booking and refund policy</Link>.
          </span>
        </label>
      )}
      <Submit label={submitLabel} />
    </form>
  );
}

export function CancelForm({
  action,
  token,
  label,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  token: string;
  label: string;
}) {
  const [state, formAction] = useActionState(action, {});
  if (state.ok) return <p className="alert ok">{state.ok}</p>;
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm('Are you sure you want to cancel this booking?')) e.preventDefault();
      }}
    >
      {state.error && <p className="alert error" role="alert">{state.error}</p>}
      <input type="hidden" name="token" value={token} />
      <button className="btn danger" type="submit">{label}</button>
    </form>
  );
}
