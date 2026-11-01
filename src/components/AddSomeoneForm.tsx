'use client';

import { useEffect, useRef, useState } from 'react';
import { addBookingAction, findClientsForClass } from '@/app/admin/actions';

type Match = Awaited<ReturnType<typeof findClientsForClass>>[number];

// Lara's "Add someone" form: search for an existing client, or add a new one
export function AddSomeoneForm({ sessionId }: { sessionId: number }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<Match | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [method, setMethod] = useState('cash');
  const latest = useRef(0);

  // Search as Lara types, ignoring answers to older searches
  useEffect(() => {
    if (chosen || isNew || query.trim().length < 2) { setMatches([]); return; }
    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await findClientsForClass(query, sessionId);
      if (ticket === latest.current) { setMatches(found); setSearching(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, chosen, isNew, sessionId]);

  const choose = (m: Match) => {
    setChosen(m);
    setMethod(m.pass ? 'pass' : 'cash');
  };
  const reset = () => { setChosen(null); setIsNew(false); setQuery(''); setMethod('cash'); };
  const ready = !!chosen || isNew;

  return (
    <form action={addBookingAction}>
      <input type="hidden" name="sessionId" value={sessionId} />

      {chosen ? (
        <div className="picked">
          <div>
            <strong>{chosen.name}</strong>
            <div className="muted">{chosen.email}{chosen.phone ? ` · ${chosen.phone}` : ''}</div>
            {chosen.pass && <div className="pass-note">Has a pass for this class: {chosen.pass}</div>}
            {chosen.booked && <div className="full">Already booked on this class</div>}
          </div>
          <button type="button" className="btn small" onClick={reset}>Change</button>
          <input type="hidden" name="customerId" value={chosen.id} />
        </div>
      ) : isNew ? (
        <>
          <p style={{ margin: '0 0 10px' }}><strong>New client</strong> · <button type="button" className="linklike" onClick={reset}>search instead</button></p>
          <label>Name<input type="text" name="name" defaultValue={/@|\d/.test(query) ? '' : query} required /></label>
          <div className="grid-2">
            <label>Email<input type="email" name="email" defaultValue={query.includes('@') ? query : ''} required /></label>
            <label>Mobile<input type="tel" name="phone" /></label>
          </div>
        </>
      ) : (
        <div className="client-search">
          <label>
            Find a client
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Start typing a name, email or phone number"
              autoComplete="off"
              aria-controls="client-results"
            />
          </label>
          {query.trim().length >= 2 && (
            <ul id="client-results" className="client-results" role="listbox" aria-label="Matching clients">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" role="option" aria-selected="false" onClick={() => choose(m)} disabled={m.booked}>
                    <strong>{m.name}</strong>
                    <span className="muted"> {m.email}</span>
                    {m.pass && <span className="pass-note"> · has a pass</span>}
                    {m.booked && <span className="muted"> · already booked</span>}
                  </button>
                </li>
              ))}
              {!searching && matches.length === 0 && <li className="muted" style={{ padding: '8px 12px' }}>No clients found.</li>}
            </ul>
          )}
          <p style={{ margin: '4px 0 14px' }}>
            <button type="button" className="linklike" onClick={() => setIsNew(true)}>+ New client</button>
          </p>
        </div>
      )}

      {ready && (
        <>
          <div className="grid-2">
            <label>
              How they paid
              <select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash / bank transfer</option>
                <option value="pass">Use their pass</option>
                <option value="free">Free (gift, prize, make-up)</option>
                <option value="manual">Other</option>
              </select>
            </label>
            {method !== 'pass' && method !== 'free' && <label>Amount £ (optional)<input type="text" name="amount" inputMode="decimal" /></label>}
          </div>
          {chosen && method === 'pass' && !chosen.pass && <p className="alert error">{chosen.name} doesn't have a pass that covers this class.</p>}
          <label>Note (optional)<input type="text" name="notes" /></label>
          <label className="check"><input type="checkbox" name="notify" defaultChecked /> Send them a confirmation email</label>
          <button className="btn navy" type="submit" disabled={!!chosen?.booked}>Add to class</button>
        </>
      )}
    </form>
  );
}
