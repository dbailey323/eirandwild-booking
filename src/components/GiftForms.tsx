'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '@/app/actions';
import { buyVoucher, voucherBalance } from '@/app/gift/actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn navy" type="submit" disabled={pending}>
      {pending ? 'Please wait…' : label}
    </button>
  );
}

export function BuyVoucherForm({ amounts, policy }: { amounts: number[]; policy: string }) {
  const [state, action] = useActionState<FormState, FormData>(buyVoucher, {});
  const [amount, setAmount] = useState(String(amounts[1] ?? amounts[0]));
  const [other, setOther] = useState('');
  const [toRecipient, setToRecipient] = useState(false);
  const total = amount === 'other' ? Number(other) || 0 : Number(amount) / 100;
  return (
    <form action={action}>
      {state.error && <p className="alert error" role="alert">{state.error}</p>}
      <fieldset>
        <legend>Amount</legend>
        <div className="amounts">
          {amounts.map((p) => (
            <label key={p}>
              <input type="radio" name="amount" value={p} checked={amount === String(p)} onChange={() => setAmount(String(p))} />
              <span>£{p / 100}</span>
            </label>
          ))}
          <label>
            <input type="radio" name="amount" value="other" checked={amount === 'other'} onChange={() => setAmount('other')} />
            <span>Other</span>
          </label>
        </div>
        {amount === 'other' && (
          <label>
            Amount £
            <input type="text" name="other" inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. 40" required />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>Who it's for</legend>
        <label>Their name<input type="text" name="recipientName" required /></label>
        <label>Your message (optional)<textarea name="message" rows={3} maxLength={500} placeholder="Happy birthday! Enjoy some time for you x" /></label>
        <label className="check">
          <input type="checkbox" name="sendToRecipient" checked={toRecipient} onChange={(e) => setToRecipient(e.target.checked)} />
          <span>Email the voucher straight to them as well</span>
        </label>
        {toRecipient && <label>Their email<input type="email" name="recipientEmail" required /></label>}
      </fieldset>

      <fieldset>
        <legend>Your details</legend>
        <label>Your name<input type="text" name="name" autoComplete="name" required /></label>
        <label>Your email<input type="email" name="email" autoComplete="email" required /></label>
        <p className="muted" style={{ marginTop: 0 }}>We'll email the voucher to you{toRecipient ? ' and to them' : ''}, ready to forward or print.</p>
      </fieldset>

      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }} />
      <label className="check">
        <input type="checkbox" name="agree" required />
        <span>{policy}</span>
      </label>
      <Submit label={total > 0 ? `Continue to payment · £${Number.isInteger(total) ? total : total.toFixed(2)}` : 'Continue to payment'} />
    </form>
  );
}

export function VoucherBalanceForm() {
  const [state, action] = useActionState<FormState, FormData>(voucherBalance, {});
  return (
    <form action={action}>
      {state.error && <p className="alert error" role="alert">{state.error}</p>}
      {state.ok && <p className="alert ok" role="status">{state.ok}</p>}
      <label>
        Voucher code
        <input type="text" name="code" placeholder="EW-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" required />
      </label>
      <Submit label="Check balance" />
    </form>
  );
}
