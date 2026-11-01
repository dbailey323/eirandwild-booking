import { NextResponse } from 'next/server';
import { ADMIN_COOKIE } from '@/lib/auth';

export async function POST() {
  const response = new NextResponse(null, { status: 303, headers: { Location: '/admin/login' } });
  response.cookies.delete(ADMIN_COOKIE);
  return response;
}
