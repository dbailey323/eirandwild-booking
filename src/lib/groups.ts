export const GROUPS: Record<string, { label: string; colour: string }> = {
  womanhood: { label: 'Womanhood', colour: '#8a1d55' },
  hiit: { label: 'Online HIIT', colour: '#0d6157' },
  motherhood: { label: 'Motherhood', colour: '#000562' },
  babymassage: { label: 'Baby Massage', colour: '#8b7355' },
};

export function groupLabel(group: string): string {
  return GROUPS[group]?.label ?? group;
}
