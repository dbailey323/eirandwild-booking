// Plain-English descriptions of passes, shared by pages and emails
import type { PassType } from './passes';
import { formatDayShort, londonToUtc } from './time';

export function creditsText(credits: number | null): string {
  if (credits === null) return 'Unlimited classes';
  return credits === 1 ? '1 class' : `${credits} classes`;
}

const day = (date: string) => formatDayShort(londonToUtc(date, '12:00'));

export function validityText(type: PassType): string {
  if (type.validity === 'dates') return `${day(type.validFrom!)} to ${day(type.validUntil!)}`;
  const days = type.validityDays ?? 0;
  if (days % 7 === 0 && days <= 56) return `valid for ${days / 7} week${days === 7 ? '' : 's'}`;
  return `valid for ${days} days`;
}

export function passSummary(type: PassType): string {
  return `${creditsText(type.credits)}, ${validityText(type)}`;
}

// e.g. "Dance & Tone, Strong & Stretched and HIIT Cardio"
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export const PASS_STATE_LABEL: Record<string, string> = {
  pending: 'Awaiting payment',
  active: 'Active',
  not_started: 'Starts soon',
  used_up: 'All used',
  ended: 'Ended',
  cancelled: 'Cancelled',
  expired: 'Not paid',
};
