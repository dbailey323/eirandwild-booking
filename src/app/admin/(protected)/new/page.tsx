import { asc } from 'drizzle-orm';
import { getDb } from '@/db';
import { classTypes, locations } from '@/db/schema';
import { GROUPS } from '@/lib/groups';
import { londonDateKey } from '@/lib/time';
import { Flash } from '@/components/Flash';
import { createClassTypeAction, createCourseAction, createLocationAction, createSessionsAction } from '@/app/admin/actions';

type Props = { searchParams: Promise<{ ok?: string; error?: string }> };

export default async function NewPage({ searchParams }: Props) {
  const { ok, error } = await searchParams;
  const db = getDb();
  const types = await db.select().from(classTypes).orderBy(asc(classTypes.name));
  const venues = await db.select().from(locations).orderBy(asc(locations.name));
  const today = londonDateKey(new Date());

  const typeSelect = (
    <label>
      Class
      <select name="classTypeId" required>
        {types.map((t) => (
          <option key={t.id} value={t.id}>{t.name} (£{(t.defaultPricePence / 100).toFixed(2)}, {t.defaultCapacity} spaces)</option>
        ))}
      </select>
    </label>
  );
  const venueSelect = (
    <label>
      Venue
      <select name="locationId">
        <option value="">Use the class's usual venue</option>
        {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <Flash ok={ok} error={error} />
      <h1>Add classes</h1>

      <details className="panel" open>
        <summary>Weekly classes (pay as you go)</summary>
        <div>
          <p className="muted">Adds the same class every week, e.g. Dance &amp; Tone every Monday for 8 weeks. Leave price and spaces blank to use the class's usual settings.</p>
          <form action={createSessionsAction}>
            {typeSelect}
            {venueSelect}
            <div className="grid-2">
              <label>First date<input type="date" name="date" min={today} required /></label>
              <label>Start time<input type="time" name="time" required /></label>
            </div>
            <div className="grid-2">
              <label>How many weeks<input type="number" name="weeks" min={1} max={52} defaultValue={8} required /></label>
              <label>Length (minutes)<input type="number" name="duration" min={10} placeholder="Usual" /></label>
            </div>
            <div className="grid-2">
              <label>Spaces<input type="number" name="capacity" min={1} placeholder="Usual" /></label>
              <label>Price £<input type="text" name="price" inputMode="decimal" placeholder="Usual" /></label>
            </div>
            <button className="btn navy" type="submit">Add classes</button>
          </form>
        </div>
      </details>

      <details className="panel">
        <summary>A course (booked as one block)</summary>
        <div>
          <p className="muted">For baby massage or a term block. One booking covers every week.</p>
          <form action={createCourseAction}>
            {typeSelect}
            <label>Course name (shown to clients)<input type="text" name="name" placeholder="Baby Massage & Mummy Relaxation, Jan/Feb" required /></label>
            {venueSelect}
            <div className="grid-2">
              <label>First date<input type="date" name="date" min={today} required /></label>
              <label>Start time<input type="time" name="time" required /></label>
            </div>
            <div className="grid-2">
              <label>Number of weeks<input type="number" name="weeks" min={1} max={20} defaultValue={4} required /></label>
              <label>Length (minutes)<input type="number" name="duration" min={10} defaultValue={55} required /></label>
            </div>
            <div className="grid-2">
              <label>Spaces<input type="number" name="capacity" min={1} required /></label>
              <label>Course price £<input type="text" name="price" inputMode="decimal" required /></label>
            </div>
            <label className="check"><input type="checkbox" name="proRata" /> Allow joining after it starts, at a reduced price for the weeks left</label>
            <label>Pay-as-you-go price £ for single weeks (leave blank if course only)<input type="text" name="dropIn" inputMode="decimal" /></label>
            <button className="btn navy" type="submit">Add course</button>
          </form>
        </div>
      </details>

      <details className="panel">
        <summary>A new type of class</summary>
        <div>
          <form action={createClassTypeAction}>
            <label>Class name<input type="text" name="name" required /></label>
            <label>
              Section
              <select name="group">
                {Object.entries(GROUPS).map(([key, g]) => <option key={key} value={key}>{g.label}</option>)}
              </select>
            </label>
            <label>Description<textarea name="description" rows={3} /></label>
            <div className="grid-2">
              <label>Usual price £<input type="text" name="price" inputMode="decimal" required /></label>
              <label>Usual spaces<input type="number" name="capacity" min={1} defaultValue={12} required /></label>
            </div>
            <div className="grid-2">
              <label>Usual length (minutes)<input type="number" name="duration" min={10} defaultValue={30} required /></label>
              {venueSelect}
            </div>
            <button className="btn" type="submit">Add class type</button>
          </form>
        </div>
      </details>

      <details className="panel">
        <summary>A new venue</summary>
        <div>
          <form action={createLocationAction}>
            <label>Venue name<input type="text" name="name" required /></label>
            <label>Address<input type="text" name="address" /></label>
            <label className="check"><input type="checkbox" name="online" /> Online (Zoom)</label>
            <button className="btn" type="submit">Add venue</button>
          </form>
        </div>
      </details>
    </>
  );
}
