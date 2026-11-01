// Adds Eir & Wild's venues and classes (prices and descriptions from Bookwhen).
// Safe to run more than once: existing venues and classes are left alone.
// Run with: npm run db:seed
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db';
import { classTypes, locations } from '../src/db/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createDb(url);

const venues = [
  { name: 'Mountsorrel Memorial Centre', address: '105 Leicester Road, Mountsorrel, LE12 7DB' },
  { name: 'Mountsorrel Library', address: 'Church House, The Green, Mountsorrel, LE12 7AS' },
  { name: 'The Rothley Centre', address: '12 Mountsorrel Lane, Rothley, LE7 7PR' },
  { name: 'Zoom (online)', address: '', online: true },
];

const venueIds: Record<string, number> = {};
for (const v of venues) {
  const [existing] = await db.select().from(locations).where(eq(locations.name, v.name));
  venueIds[v.name] = existing?.id ?? (await db.insert(locations).values(v).returning())[0].id;
}

// Capacities are placeholders: Lara should set her real numbers in the admin area
const classes = [
  { slug: 'dance-tone', name: 'Dance & Tone', group: 'womanhood', price: 700, minutes: 30, venue: 'Mountsorrel Memorial Centre',
    description: 'A 30-minute dance class set to current chart music, mixing dance styles to help you tone up and boost your fitness. The fun atmosphere means you won’t even realise you are exercising!' },
  { slug: 'strong-stretched', name: 'Strong & Stretched', group: 'womanhood', price: 700, minutes: 30, venue: 'Mountsorrel Memorial Centre',
    description: 'A gentle warm-up, full-body muscle conditioning and a deep, restorative stretch. Builds strength without heavy impact.' },
  { slug: 'monday-double', name: 'Monday Double', group: 'womanhood', price: 1000, minutes: 60, venue: 'Mountsorrel Memorial Centre',
    description: 'Dance & Tone followed by Strong & Stretched, back-to-back, at a discounted price.' },
  { slug: 'hiit-cardio', name: 'HIIT Cardio', group: 'hiit', price: 700, minutes: 30, venue: 'Zoom (online)',
    description: 'A quick, effective 30-minute cardio workout streamed live on Zoom. No equipment needed. One booking covers one screen. Not suitable during pregnancy.' },
  { slug: 'hiit-strength', name: 'HIIT Strength', group: 'hiit', price: 700, minutes: 30, venue: 'Zoom (online)',
    description: 'A 30-minute strength workout with light weights and bodyweight exercises, streamed live on Zoom. One booking covers one screen. Not suitable during pregnancy.' },
  { slug: 'strong-mummy', name: 'The Strong Mummy Movement', group: 'motherhood', price: 900, minutes: 55, venue: 'Mountsorrel Memorial Centre',
    description: 'Low-impact interval training for mums, with time to chat and connect first. Pre-crawlers welcome on a mat beside you, and under-5s are welcome.' },
  { slug: 'strong-women', name: 'Strong Women Squad', group: 'motherhood', price: 900, minutes: 55, venue: 'The Rothley Centre',
    description: 'Low-impact interval training for all women, with safe options for pregnancy (from 10–12 weeks) and postnatal recovery.' },
  { slug: 'bums-tums', name: 'Strong Mums, Bums & Tums', group: 'motherhood', price: 900, minutes: 30, venue: 'The Rothley Centre',
    description: 'A 30-minute core and glute-focused class using bands, balls and bodyweight. Open to all women, with or without little ones.' },
  { slug: 'baby-massage', name: 'Baby Massage & Mummy Relaxation', group: 'babymassage', price: 5000, minutes: 55, venue: 'The Rothley Centre',
    description: 'A 4-week course teaching soothing massage techniques, with handouts and fractionated coconut oil included. For babies from 6–8 weeks to pre-crawling.' },
];

for (const c of classes) {
  const [existing] = await db.select().from(classTypes).where(eq(classTypes.slug, c.slug));
  if (existing) continue;
  await db.insert(classTypes).values({
    slug: c.slug,
    name: c.name,
    group: c.group,
    description: c.description,
    defaultPricePence: c.price,
    defaultCapacity: 12,
    defaultDurationMinutes: c.minutes,
    defaultLocationId: venueIds[c.venue],
  });
}

console.log(`Venues: ${Object.keys(venueIds).length}, classes: ${classes.length}`);
process.exit(0);
