'use client';

import { useActionState, useState } from 'react';
import { importClientsAction, type ImportState } from '@/app/admin/actions';

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importClientsAction, {});
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');

  return (
    <form action={action}>
      {state.error && <p className="alert error" role="alert">{state.error}</p>}
      {state.ok && <p className="alert ok" role="status">{state.ok}</p>}
      <label>
        Bookwhen export file (.csv)
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setFileName(file?.name ?? '');
            setCsv(file ? await file.text() : '');
          }}
        />
      </label>
      <input type="hidden" name="csv" value={csv} />

      {state.preview && !state.ok && (
        <div className="card soft" style={{ marginTop: 10 }}>
          <h2>Check before importing</h2>
          <p>
            Found <strong>{state.preview.total}</strong> {state.preview.total === 1 ? 'client' : 'clients'} with email addresses
            {fileName ? ` in ${fileName}` : ''}. Columns used: {state.preview.columns.join(', ')}.
          </p>
          <table className="table">
            <tbody>
              {state.preview.clients.map((c) => (
                <tr key={c.email}><td>{c.name}</td><td className="hide-sm">{c.email}</td><td className="hide-sm">{c.phone}</td></tr>
              ))}
            </tbody>
          </table>
          {state.preview.total > state.preview.clients.length && <p className="muted">…and {state.preview.total - state.preview.clients.length} more.</p>}
          {state.preview.skipped.length > 0 && (
            <details>
              <summary className="muted" style={{ cursor: 'pointer' }}>{state.preview.skipped.length} rows will be skipped</summary>
              <ul>{state.preview.skipped.map((s) => <li key={s.line}>Row {s.line}: {s.reason}</li>)}</ul>
            </details>
          )}
          <p className="muted">Clients already here are left as they are (a missing mobile number is filled in). Nobody is emailed.</p>
        </div>
      )}

      <div className="row-actions">
        <button className="btn" type="submit" name="mode" value="preview" disabled={pending || !csv}>Preview</button>
        {state.preview && !state.ok && (
          <button className="btn navy" type="submit" name="mode" value="import" disabled={pending || !csv}>
            {pending ? 'Importing…' : `Import ${state.preview.total} clients`}
          </button>
        )}
      </div>
    </form>
  );
}
