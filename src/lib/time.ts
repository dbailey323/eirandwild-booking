// All classes run in UK time. Dates are stored in UTC and shown in Europe/London,
// which moves between GMT and BST, so conversions go through Intl rather than
// assuming a fixed offset.

export const TZ = 'Europe/London';

// Minutes London is ahead of UTC at a given instant (0 in winter, 60 in summer)
function londonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

// "2026-11-02" + "18:30" in London -> the matching UTC instant
export function londonToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset, including on the days the clocks change
  let result = new Date(guess - londonOffsetMinutes(new Date(guess)) * 60000);
  result = new Date(guess - londonOffsetMinutes(result) * 60000);
  return result;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

// Same London wall-clock time, n days later (keeps 6:30pm across clock changes)
export function addLondonDays(date: Date, days: number): Date {
  const ymd = londonDateKey(date);
  const hm = formatTime24(date);
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return londonToUtc(next.toISOString().slice(0, 10), hm);
}

// "2026-11-02" in London
export function londonDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function formatTime24(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

// "6:30pm"
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(date)
    .replace(' ', '')
    .replace(':00', '')
    .toLowerCase();
}

// "Monday 2 November"
export function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

// "Mon 2 Nov"
export function formatDayShort(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)} to ${formatTime(end)}`;
}
