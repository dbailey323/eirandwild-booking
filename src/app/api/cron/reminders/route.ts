import { getDb } from '@/db';
import { markReminderSent, remindersDue } from '@/lib/booking';
import { sendReminder } from '@/lib/email';
import { appUrl } from '@/lib/stripe';

// Runs daily (see vercel.json) and emails everyone booked on tomorrow's classes
export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorised', { status: 401 });
  }
  const db = getDb();
  const due = await remindersDue(db);
  let sent = 0;
  for (const row of due) {
    const where = row.location ? (row.location.online ? 'Online via Zoom' : `${row.location.name}${row.location.address ? `, ${row.location.address}` : ''}`) : '';
    try {
      await sendReminder(row.customer.email, row.customer.name, row.classType.name, row.session.startsAt, row.session.endsAt, where, `${appUrl()}/booking/${row.booking.manageToken}`);
      await markReminderSent(db, row.registration.id);
      sent++;
    } catch (error) {
      console.error('Reminder failed', row.registration.id, error);
    }
  }
  return Response.json({ due: due.length, sent });
}
