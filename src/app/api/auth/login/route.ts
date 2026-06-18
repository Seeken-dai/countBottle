import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { AUTH_COOKIE_NAME } from "@/lib/auth-cookie";

export const runtime = "nodejs";

const FIREBASE_API_KEY = "AIzaSyA8XsBNIYhQ7MM3eF7y9uSdWvNkzi5D-B4";

type AuthResponseUser = {
  localId: string;
  email: string;
  displayName: string | null;
  registered: boolean;
};

export async function POST(request: Request) {
  try {
    const { email, password, idToken: providedIdToken } = await request.json();

    let idToken = providedIdToken;
    let authData: AuthResponseUser | null = null;

    if (!idToken) {
      // Fetch from Firebase Identity Toolkit REST API
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: data.error.message }, { status: 401 });
      }
      authData = {
        localId: data.localId,
        email: data.email,
        displayName: data.displayName || null,
        registered: data.registered,
      };
      idToken = data.idToken;
    }
    
    // Create session cookie (expires in 5 days)
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

    const response = NextResponse.json({ success: true, user: authData });
    response.cookies.set(AUTH_COOKIE_NAME, sessionCookie, {
      maxAge: expiresIn / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
