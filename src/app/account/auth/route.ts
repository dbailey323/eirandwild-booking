import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db';
import { clientSessionCookie, redeemClientLoginToken } from '@/lib/clientAuth';

function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

// The link in a client's sign-in email lands here
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const nextParam = request.nextUrl.searchParams.get('next') ?? '/account';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/account';
  const customerId = token ? await redeemClientLoginToken(getDb(), token) : null;
  if (!customerId) return redirectTo(`/account/login?error=expired&next=${encodeURIComponent(next)}`);
  const response = redirectTo(next);
  const cookie = await clientSessionCookie(customerId);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
