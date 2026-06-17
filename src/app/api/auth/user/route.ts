import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session")?.value;

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
        photoURL: decodedClaims.picture || null,
      }
    });
  } catch (error) {
    return NextResponse.json({ authenticated: false, error: "Unauthorized" }, { status: 401 });
  }
}
