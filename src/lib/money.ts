export function formatPence(pence: number): string {
  if (pence === 0) return 'Free';
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

// "7" or "7.50" (from an admin form) -> pence
export function poundsToPence(value: string): number {
  const n = Number(String(value).replace(/[£,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new Error('Enter a valid price');
  return Math.round(n * 100);
}
