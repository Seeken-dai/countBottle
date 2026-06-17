import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const FIREBASE_API_KEY = "AIzaSyA8XsBNIYhQ7MM3eF7y9uSdWvNkzi5D-B4";

export async function POST(request: Request) {
  try {
    const { email, password, displayName } = await request.json();

    // Fetch from Firebase Identity Toolkit REST API
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.error.message }, { status: 400 });
    }

    const idToken = data.idToken;
    
    // Update display name
    if (displayName) {
      await adminAuth.updateUser(data.localId, { displayName });
      data.displayName = displayName;
    }

    // Create session cookie
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

    // Initialize user in Firestore
    const { adminDb } = await import("@/lib/firebase-admin");
    await adminDb.collection("Users").doc(data.localId).set({
      uid: data.localId,
      email: data.email,
      displayName: displayName || email.split("@")[0],
      photoURL: null,
      themePreference: "system",
      createdAt: new Date().toISOString()
    });

    const response = NextResponse.json({ success: true, user: data });
    response.cookies.set("session", sessionCookie, {
      maxAge: expiresIn / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
