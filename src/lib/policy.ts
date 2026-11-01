// Lara's booking rules, in one place.

// Stripe checkouts must stay open for at least 30 minutes; the place is held a little
// longer than the checkout so it can never be released while someone is still paying
export const CHECKOUT_MINUTES = 31;
export const HOLD_MINUTES = 33;

// Refunds: pay-as-you-go needs 4 hours' notice; courses need 48 hours before the course starts
export const PAYG_CANCEL_HOURS = 4;
export const COURSE_CANCEL_HOURS = 48;

export const REFUND_POLICY = [
  'Refunds are given on pay-as-you-go classes cancelled at least 4 hours before the class starts.',
  'For courses, let us know at least 48 hours before the course starts to receive a refund.',
  'Classes booked with a pass go back on your pass if cancelled at least 4 hours before the class starts.',
  'Cancellations within these times cannot be refunded or transferred.',
];

export function cancellationDeadline(kind: 'session' | 'course', firstSessionStart: Date): Date {
  const hours = kind === 'course' ? COURSE_CANCEL_HOURS : PAYG_CANCEL_HOURS;
  return new Date(firstSessionStart.getTime() - hours * 3600 * 1000);
}

export function canRefund(kind: 'session' | 'course', firstSessionStart: Date, now = new Date()): boolean {
  return now.getTime() <= cancellationDeadline(kind, firstSessionStart).getTime();
}

// Pro-rata course price for the sessions still to come, rounded to the nearest 50p
export function proRataPrice(coursePricePence: number, totalSessions: number, remainingSessions: number): number {
  if (remainingSessions >= totalSessions) return coursePricePence;
  const raw = (coursePricePence * remainingSessions) / totalSessions;
  return Math.round(raw / 50) * 50;
}

// Passes are not refundable once bought, but Lara can choose to refund one herself
export const PASS_POLICY = 'Passes can be used for the classes listed, until the end date shown. Passes are non-refundable and cannot be transferred.';

// Gift vouchers: how long they last and the amounts people can buy online
export const VOUCHER_MONTHS = 12;
export const VOUCHER_MIN_PENCE = 500;
export const VOUCHER_MAX_PENCE = 50000;
export const VOUCHER_AMOUNTS_PENCE = [1000, 2500, 5000];
export const VOUCHER_POLICY = `Gift vouchers can be spent on any Eir & Wild class, course or pass booked online within ${VOUCHER_MONTHS} months of purchase. They can be used over several bookings, and cannot be exchanged for cash.`;
