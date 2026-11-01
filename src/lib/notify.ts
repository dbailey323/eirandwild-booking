import { inArray } from 'drizzle-orm';
import { classTypes } from '@/db/schema';
import { getCourse, getSession, takeWaitlistForFreedSessions, type Db } from './booking';
import { sendPassConfirmed, sendWaitlistSpace } from './email';
import { getPassDetail } from './passes';
import { creditsText, listNames } from './passText';
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

// Emails a client their new pass
export async function notifyPassReady(db: Db, passId: string) {
  const detail = await getPassDetail(db, passId);
  if (!detail || detail.pass.status !== 'active') return;
  const names = detail.classTypeIds.length
    ? (await db.select().from(classTypes).where(inArray(classTypes.id, detail.classTypeIds))).map((c) => c.name)
    : [];
  await safely(() =>
    sendPassConfirmed(detail.customer.email, detail.customer.name, {
      name: detail.type.name,
      credits: creditsText(detail.pass.creditsTotal),
      classes: listNames(names),
      until: passEndText(detail.pass.expiresAt),
      amountPence: detail.pass.amountPence,
    }),
  );
}

// "4 classes left" for the booking confirmation
export async function passLeftText(db: Db, passId: string | null): Promise<string | undefined> {
  if (!passId) return undefined;
  const detail = await getPassDetail(db, passId);
  if (!detail) return undefined;
  return detail.creditsLeft === null ? 'unlimited' : `${detail.creditsLeft} ${detail.creditsLeft === 1 ? 'class' : 'classes'} left`;
}

// The last day a pass can be used, e.g. "Sat 30 Jan" (expiresAt is midnight after it)
export function passEndText(expiresAt: Date | null): string | null {
  return expiresAt ? formatDayShort(new Date(expiresAt.getTime() - 60000)) : null;
}
