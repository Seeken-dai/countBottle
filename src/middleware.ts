import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect Firestore proxy routes
  if (pathname.startsWith('/v1/projects/') || pathname.startsWith('/google.firestore.v1.Firestore/')) {
    const session = request.cookies.get('session');
    if (!session || !session.value) {
      return new NextResponse(
        JSON.stringify({ error: "Unauthorized Firestore Access" }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      );
    }
    // If session exists, allow the rewrite to proceed
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
