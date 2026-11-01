import { getCourse, getSession, takeWaitlistForFreedSessions, type Db } from './booking';
import { sendWaitlistSpace } from './email';
import { appUrl } from './stripe';
import { formatDayShort, formatTime } from './time';

// Emails should never stop a booking going through: log failures instead of throwing
export async function safely(send: () => Promise<void>) {
  try {
    await send();
  } catch (error) {
    console.error('Email failed', error);
  }
}

// Tells everyone waiting for the given sessions (or their courses) that a place is free
export async function notifyWaitlist(db: Db, sessionIds: number[]) {
  const entries = await takeWaitlistForFreedSessions(db, sessionIds);
  for (const { entry, customer } of entries) {
    let title = 'your class';
    let path = '/';
    if (entry.sessionId) {
      const item = await getSession(db, entry.sessionId);
      if (item) title = `${item.classType.name}, ${formatDayShort(item.session.startsAt)} ${formatTime(item.session.startsAt)}`;
      path = `/class/${entry.sessionId}`;
    } else if (entry.courseId) {
      const course = await getCourse(db, entry.courseId);
      if (course) title = course.course.name;
      path = `/course/${entry.courseId}`;
    }
    await safely(() => sendWaitlistSpace(customer.email, customer.name, title, `${appUrl()}${path}`));
  }
}
