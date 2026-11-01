'use client';

import { useActionState } from 'react';
import { requestLoginLink } from '../actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(requestLoginLink, {});
  if (state.ok) return <p className="alert ok">{state.ok}</p>;
  return (
    <form action={action}>
      <label>
        Email
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <button className="btn navy" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send sign-in link'}
      </button>
    </form>
  );
}
