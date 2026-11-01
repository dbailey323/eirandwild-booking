// Admin sign-in for Lara: she enters her email, gets a one-time link, and the link sets
// a signed cookie. Only addresses listed in ADMIN_EMAILS can sign in.

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { adminLoginTokens } from '@/db/schema';
import type { Db } from './booking';

export const ADMIN_COOKIE = 'ew_admin';
const COOKIE = ADMIN_COOKIE;
const LINK_MINUTES = 20;
const SESSION_DAYS = 30;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) throw new Error('AUTH_SECRET must be set to a long random string');
  return new TextEncoder().encode(value);
}

export function isAdminEmail(email: string): boolean {
  const allowed = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

// Returns a one-time token for an allowed admin email, or null (without saying why)
export async function createLoginToken(db: Db, email: string, now = new Date()): Promise<string | null> {
  if (!isAdminEmail(email)) return null;
  const token = randomBytes(32).toString('base64url');
  await db.insert(adminLoginTokens).values({
    tokenHash: hash(token),
    email: email.trim().toLowerCase(),
    expiresAt: new Date(now.getTime() + LINK_MINUTES * 60000),
  });
  return token;
}

// Uses up a token and returns the email it was issued to
export async function redeemLoginToken(db: Db, token: string, now = new Date()): Promise<string | null> {
  const [row] = await db
    .update(adminLoginTokens)
    .set({ usedAt: now })
    .where(and(eq(adminLoginTokens.tokenHash, hash(token)), isNull(adminLoginTokens.usedAt), gt(adminLoginTokens.expiresAt, now)))
    .returning();
  return row && isAdminEmail(row.email) ? row.email : null;
}

// The signed cookie that keeps Lara signed in, for the auth route to attach to its redirect
export async function adminSessionCookie(email: string) {
  const jwt = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  return {
    name: COOKIE,
    value: jwt,
    options: {
      httpOnly: true,
      // Secure (https-only) on the real site; plain http is only used for local testing
      secure: (process.env.APP_URL ?? '').startsWith('https://'),
      sameSite: 'lax' as const,
      path: '/',
      maxAge: SESSION_DAYS * 24 * 3600,
    },
  };
}

export async function currentAdmin(): Promise<string | null> {
  const jwt = (await cookies()).get(COOKIE)?.value;
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, secret());
    const email = String(payload.email ?? '');
    return isAdminEmail(email) ? email : null;
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<string> {
  const email = await currentAdmin();
  if (!email) redirect('/admin/login');
  return email;
}
