import { adminAuth } from "@/lib/firebase-admin";
import { AUTH_COOKIE_NAME } from "@/lib/auth-cookie";
import { cookies } from "next/headers";

export async function verifyUser() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie);
    return decodedClaims;
  } catch {
    return null;
  }
}
