import { NextResponse } from "next/server";

const FIREBASE_API_KEY = "AIzaSyA8XsBNIYhQ7MM3eF7y9uSdWvNkzi5D-B4";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message || "RESET_PASSWORD_FAILED" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
