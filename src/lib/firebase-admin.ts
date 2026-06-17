import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const app = !getApps().length ? initializeApp() : getApp();

export const adminDb = getFirestore(app);
export const adminAuth = getAuth(app);
