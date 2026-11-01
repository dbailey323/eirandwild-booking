import { asc } from 'drizzle-orm';
import { getDb } from '@/db';
import { classTypes } from '@/db/schema';
import { formatPence } from '@/lib/money';
import { listPassTypes } from '@/lib/passes';
import { listNames, passSummary } from '@/lib/passText';
import { londonDateKey } from '@/lib/time';
import { Flash } from '@/components/Flash';
import { createPassTypeAction, passTypeOnSaleAction } from '@/app/admin/actions';

type Props = { searchParams: Promise<{ ok?: string; error?: string }> };

export default async function AdminPassesPage({ searchParams }: Props) {
  const { ok, error } = await searchParams;
  const db = getDb();
  const [types, classes] = await Promise.all([listPassTypes(db), db.select().from(classTypes).orderBy(asc(classTypes.group), asc(classTypes.name))]);
  const name = new Map(classes.map((c) => [c.id, c.name]));
  const today = londonDateKey(new Date());

  return (
    <>
      <Flash ok={ok} error={error} />
      <h1>Passes</h1>
      <p className="muted">Passes clients can buy on the booking site, or that you give to someone from their client page (prizes, PT memberships, cash payments).</p>

      <section className="card soft">
        {types.length === 0 && <p className="muted">No passes yet.</p>}
        {types.map((t) => {
          const over = t.validity === 'dates' && (t.validUntil ?? '') < today;
          return (
            <div key={t.id} className="pass">
              <div className="pass-head">
                <strong>{t.name}</strong>
                <span className="pass-left">{formatPence(t.pricePence)}</span>
              </div>
              <div className="muted">{passSummary(t)} · {listNames(t.classTypeIds.map((id) => name.get(id) ?? '').filter(Boolean))}</div>
              <form action={passTypeOnSaleAction} className="row-actions" style={{ marginTop: 8 }}>
                <input type="hidden" name="passTypeId" value={t.id} />
                <input type="hidden" name="onSale" value={t.onSale ? 'false' : 'true'} />
                <span className={t.onSale && !over ? '' : 'muted'}>
                  {over ? 'Term finished' : t.onSale ? 'On sale on the booking site' : 'Not on sale (you can still give it to people)'}
                </span>
                {!over && <button className="btn small" type="submit">{t.onSale ? 'Take off sale' : 'Put on sale'}</button>}
              </form>
            </div>
          );
        })}
      </section>

      <details className="panel">
        <summary>Add a pass</summary>
        <div>
          <form action={createPassTypeAction}>
            <label>Name<input type="text" name="name" placeholder="e.g. Motherhood spring term (6 classes)" required /></label>
            <label>Description (optional)<input type="text" name="description" /></label>
            <div className="grid-2">
              <label>Price £<input type="text" name="price" inputMode="decimal" placeholder="0 for a free pass" required /></label>
              <label>Number of classes<input type="number" name="credits" min={1} placeholder="Blank = unlimited" /></label>
            </div>
            <fieldset>
              <legend>How long it lasts</legend>
              <label className="check"><input type="radio" name="validity" value="days" defaultChecked /> A number of days from when it's bought</label>
              <label>Days<input type="number" name="days" min={1} placeholder="e.g. 90" /></label>
              <label className="check"><input type="radio" name="validity" value="dates" /> Between set dates (a term pass)</label>
              <div className="grid-2">
                <label>First date<input type="date" name="from" /></label>
                <label>Last date<input type="date" name="until" /></label>
              </div>
            </fieldset>
            <fieldset>
              <legend>Classes it can be used for</legend>
              {classes.filter((c) => c.active).map((c) => (
                <label key={c.id} className="check"><input type="checkbox" name="classTypeIds" value={c.id} /> {c.name}</label>
              ))}
            </fieldset>
            <label className="check"><input type="checkbox" name="onSale" defaultChecked /> Sell it on the booking site</label>
            <button className="btn navy" type="submit">Add pass</button>
          </form>
        </div>
      </details>
    </>
  );
}
