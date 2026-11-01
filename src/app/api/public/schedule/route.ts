import { getDb } from '@/db';
import { listSessions } from '@/lib/booking';
import { appUrl } from '@/lib/stripe';
import { addLondonDays } from '@/lib/time';

export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = ['https://www.eirandwild.co.uk', 'https://eirandwild.co.uk'];

// Upcoming classes for the main website (live dates and spaces left)
export async function GET(request: Request) {
  const now = new Date();
  const items = await listSessions(getDb(), { from: now, to: addLondonDays(now, 12 * 7) });
  const origin = request.headers.get('origin') ?? '';
  const body = items.map(({ session, classType, location, course, spacesLeft }) => ({
    id: session.id,
    title: classType.name,
    slug: classType.slug,
    group: classType.group,
    startAt: session.startsAt.toISOString(),
    endAt: session.endsAt.toISOString(),
    venue: location ? (location.online ? 'Online' : location.name) : '',
    spacesLeft,
    pricePence: session.pricePence,
    courseId: course?.id ?? null,
    bookingUrl: session.pricePence === null && course ? `${appUrl()}/course/${course.id}` : `${appUrl()}/class/${session.id}`,
  }));
  return Response.json(body, {
    headers: {
      'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      ...(ALLOWED_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
  });
}
