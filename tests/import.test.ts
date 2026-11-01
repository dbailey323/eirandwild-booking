import { describe, expect, it } from 'vitest';
import { upsertCustomer } from '@/lib/booking';
import { importClients, parseCsv, readClients } from '@/lib/importClients';
import { searchCustomers } from '@/lib/passes';
import { testDb } from './helpers';

describe('reading a client export', () => {
  it('handles quotes, commas and line breaks', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  });

  it('finds the columns in a Bookwhen-style export', () => {
    const csv = [
      'First name,Last name,Email address,Mobile phone,Bookings',
      'sarah,JONES,Sarah@Example.com,07700 900001,4',
      'Amy,Smith,amy@example.com,,2',
      'No,Email,,07700 900003,1',
      'Sarah,Jones,sarah@example.com,07700 900009,1',
    ].join('\n');
    const result = readClients(csv);
    expect(result.clients).toEqual([
      { name: 'Sarah Jones', email: 'sarah@example.com', phone: '07700 900001' },
      { name: 'Amy Smith', email: 'amy@example.com', phone: '' },
    ]);
    expect(result.skipped).toEqual([{ line: 4, reason: 'No email address' }]);
    expect(result.columns).toEqual(['Email address', 'First name', 'Last name', 'Mobile phone']);
  });

  it('works with a single name column and semicolons', () => {
    const result = readClients('Name;Email;Phone\nJo Bloggs;jo@example.com;0116 000');
    expect(result.clients).toEqual([{ name: 'Jo Bloggs', email: 'jo@example.com', phone: '0116 000' }]);
  });
});

describe('importing clients', () => {
  it('adds new clients and leaves existing ones alone', async () => {
    const db = await testDb();
    await upsertCustomer(db, { name: 'Alice Lara Knows', email: 'alice@example.com', phone: '' });
    const result = await importClients(db, [
      { name: 'Alice A', email: 'alice@example.com', phone: '07000 000001' },
      { name: 'Bea', email: 'bea@example.com', phone: '' },
    ]);
    expect(result).toEqual({ added: 1, existing: 1 });
    const [alice] = await searchCustomers(db, 'alice@');
    expect(alice.name).toBe('Alice Lara Knows');
    expect(alice.phone).toBe('07000 000001');
    expect(await importClients(db, [{ name: 'Bea', email: 'bea@example.com', phone: '' }])).toEqual({ added: 0, existing: 1 });
  });
});
