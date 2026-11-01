import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db';
import { adminSessionCookie, redeemLoginToken } from '@/lib/auth';

// Relative redirects keep the browser on the address it used, so the cookie matches
function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

// The link in the sign-in email lands here
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const email = token ? await redeemLoginToken(getDb(), token) : null;
  if (!email) return redirectTo('/admin/login?error=expired');
  const response = redirectTo('/admin');
  const cookie = await adminSessionCookie(email);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
