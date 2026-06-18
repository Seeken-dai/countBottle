import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { AUTH_COOKIE_NAME } from "@/lib/auth-cookie";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!sessionCookie) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie);

    return NextResponse.json({
      authenticated: true,
      user: {
        uid: decodedClaims.uid,
        email: decodedClaims.email || null,
        displayName: decodedClaims.name || decodedClaims.email?.split("@")[0] || null,
        photoURL: null,
      }
    });
  } catch {
    return NextResponse.json({ authenticated: false, error: "Unauthorized" }, { status: 401 });
  }
}
