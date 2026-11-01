'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import type { FormState } from '@/app/actions';
import { bookWithPassAction, requestClientLink } from '@/app/account/actions';

function Submit({ label, pendingLabel = 'Please wait…' }: { label: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn navy" type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function ClientLoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(requestClientLink, {});
  if (state.ok) return <p className="alert ok">{state.ok}</p>;
  return (
    <form action={action}>
      {state.error && <p className="alert error" role="alert">{state.error}</p>}
      <input type="hidden" name="next" value={next} />
      <label>
        Email
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <Submit label="Email me a sign-in link" pendingLabel="Sending…" />
    </form>
  );
}

export type PassChoice = { id: string; label: string };

// "Book with my pass" on a class page, for signed-in clients with a pass that covers it
export function PassBookForm({ sessionId, passes }: { sessionId: number; passes: PassChoice[] }) {
  const [state, action] = useActionState<FormState, FormData>(bookWithPassAction, {});
  return (
    <form action={action}>
      {state.error && <p className="alert error" role="alert">{state.error}</p>}
      <input type="hidden" name="sessionId" value={sessionId} />
      {passes.length > 1 ? (
        <label>
          Which pass?
          <select name="passId" defaultValue={passes[0].id}>
            {passes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      ) : (
        <>
          <input type="hidden" name="passId" value={passes[0].id} />
          <p style={{ margin: '0 0 12px' }}>Using: <strong>{passes[0].label}</strong></p>
        </>
      )}
      <label className="check">
        <input type="checkbox" name="agree" required />
        <span>I agree to the <Link href="/policies" target="_blank">booking and refund policy</Link>.</span>
      </label>
      <Submit label="Book with my pass" />
    </form>
  );
}
