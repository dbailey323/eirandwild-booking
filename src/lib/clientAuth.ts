// Client accounts: no passwords. A client enters their email, gets a one-time link, and
// the link sets a signed cookie for 90 days. Only people who have booked before (or
// bought a pass) have an account.

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { customerLoginTokens, customers } from '@/db/schema';
import type { Db } from './booking';

export const CLIENT_COOKIE = 'ew_client';
export const CLIENT_LINK_MINUTES = 60;
const SESSION_DAYS = 90;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) throw new Error('AUTH_SECRET must be set to a long random string');
  return new TextEncoder().encode(value);
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

// Returns a one-time token and the client for a known email, or null
export async function createClientLoginToken(db: Db, email: string, now = new Date()) {
  const [customer] = await db.select().from(customers).where(eq(customers.email, email.trim().toLowerCase()));
  if (!customer) return null;
  const token = randomBytes(32).toString('base64url');
  await db.insert(customerLoginTokens).values({
    tokenHash: hash(token),
    customerId: customer.id,
    expiresAt: new Date(now.getTime() + CLIENT_LINK_MINUTES * 60000),
  });
  return { token, customer };
}

export async function redeemClientLoginToken(db: Db, token: string, now = new Date()): Promise<number | null> {
  const [row] = await db
    .update(customerLoginTokens)
    .set({ usedAt: now })
    .where(and(eq(customerLoginTokens.tokenHash, hash(token)), isNull(customerLoginTokens.usedAt), gt(customerLoginTokens.expiresAt, now)))
    .returning();
  return row?.customerId ?? null;
}

export async function clientSessionCookie(customerId: number) {
  const jwt = await new SignJWT({ cid: customerId, kind: 'client' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  return {
    name: CLIENT_COOKIE,
    value: jwt,
    options: {
      httpOnly: true,
      secure: (process.env.APP_URL ?? '').startsWith('https://'),
      sameSite: 'lax' as const,
      path: '/',
      maxAge: SESSION_DAYS * 24 * 3600,
    },
  };
}

// The signed-in client's id, or null
export async function currentClientId(): Promise<number | null> {
  const jwt = (await cookies()).get(CLIENT_COOKIE)?.value;
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, secret());
    return payload.kind === 'client' && typeof payload.cid === 'number' ? payload.cid : null;
  } catch {
    return null;
  }
}

export async function currentClient(db: Db) {
  const id = await currentClientId();
  if (!id) return null;
  const [customer] = await db.select().from(customers).where(eq(customers.id, id));
  return customer ?? null;
}

export async function requireClient(db: Db, next = '/account') {
  const customer = await currentClient(db);
  if (!customer) redirect(`/account/login?next=${encodeURIComponent(next)}`);
  return customer;
}
