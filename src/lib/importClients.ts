// Importing clients from a Bookwhen (or any) spreadsheet export. Column names are
// matched loosely ("Email address", "First name", "Surname", "Mobile"...), so the file
// can come straight from Bookwhen's export without editing.

import { sql } from 'drizzle-orm';
import { customers } from '@/db/schema';
import type { Db } from './booking';

export type ImportClient = { name: string; email: string; phone: string };
export type ImportResult = { clients: ImportClient[]; skipped: { line: number; reason: string }[]; columns: string[] };

// RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  // Some exports use semicolons or tabs instead of commas
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function findColumn(headers: string[], tests: RegExp[], exclude: number[] = []): number {
  for (const test of tests) {
    const i = headers.findIndex((h, idx) => !exclude.includes(idx) && test.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

const titleCase = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : s);

export function readClients(text: string): ImportResult {
  const rows = parseCsv(text);
  // The header is the first row that mentions an email column
  const headerIndex = rows.findIndex((r) => r.some((h) => /e-?mail/i.test(h)));
  if (headerIndex < 0) return { clients: [], skipped: [], columns: [] };
  const headers = rows[headerIndex].map((h) => h.trim().toLowerCase());
  const email = findColumn(headers, [/^e-?mail( address)?$/, /e-?mail/]);
  const first = findColumn(headers, [/^first/, /forename/, /given/]);
  const last = findColumn(headers, [/^last/, /surname/, /family/]);
  const full = findColumn(headers, [/^(full |contact |customer |attendee |booker )?name$/, /name/], [first, last, email]);
  const phone = findColumn(headers, [/mobile/, /phone/, /^tel/]);

  const byEmail = new Map<string, ImportClient>();
  const skipped: ImportResult['skipped'] = [];
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const line = headerIndex + i + 2;
    const address = (r[email] ?? '').trim().toLowerCase();
    if (!EMAIL.test(address)) { skipped.push({ line, reason: address ? `"${address}" isn't an email address` : 'No email address' }); return; }
    const parts = first >= 0 ? [r[first] ?? '', last >= 0 ? r[last] ?? '' : ''] : [r[full] ?? ''];
    let name = parts.map((p) => titleCase(p.trim().replace(/\s+/g, ' '))).filter(Boolean).join(' ');
    if (!name) name = address.split('@')[0];
    const tel = phone >= 0 ? (r[phone] ?? '').trim() : '';
    const existing = byEmail.get(address);
    if (existing) { if (!existing.phone && tel) existing.phone = tel; return; }
    byEmail.set(address, { name, email: address, phone: tel });
  });
  const columns = [email, first, last, full, phone].filter((i) => i >= 0).map((i) => rows[headerIndex][i].trim());
  return { clients: [...byEmail.values()], skipped, columns };
}

// Adds clients who aren't already here. Existing clients are left as they are, except a
// missing phone number is filled in.
export async function importClients(db: Db, clients: ImportClient[]): Promise<{ added: number; existing: number }> {
  let added = 0;
  for (let i = 0; i < clients.length; i += 200) {
    const batch = clients.slice(i, i + 200);
    const rows = await db
      .insert(customers)
      .values(batch)
      .onConflictDoUpdate({ target: customers.email, set: { phone: sql`case when ${customers.phone} = '' then excluded.phone else ${customers.phone} end` } })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    added += rows.filter((r) => r.inserted).length;
  }
  return { added, existing: clients.length - added };
}
