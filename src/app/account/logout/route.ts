import { NextResponse } from 'next/server';
import { CLIENT_COOKIE } from '@/lib/clientAuth';

export async function POST() {
  const response = new NextResponse(null, { status: 303, headers: { Location: '/' } });
  response.cookies.delete(CLIENT_COOKIE);
  return response;
}
