import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/v1/projects/') || pathname.startsWith('/google.firestore.v1.Firestore/')) {
    const session = request.cookies.get(AUTH_COOKIE_NAME);
    if (!session || !session.value) {
      return new NextResponse(
        JSON.stringify({ error: "Unauthorized Firestore Access" }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/v1/projects/:path*',
    '/google.firestore.v1.Firestore/:path*'
  ]
};
