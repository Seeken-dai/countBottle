import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
// import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA8XsBNIYhQ7MM3eF7y9uSdWvNkzi5D-B4",
  authDomain: "countbottle-web.firebaseapp.com",
  projectId: "countbottle-web",
  storageBucket: "countbottle-web.firebasestorage.app",
  messagingSenderId: "534106582981",
  appId: "1:534106582981:web:054284a066bdbae76465ac",
  measurementId: "G-5488F7W8PR"
};


// Initialize Firebase (Singleton pattern to prevent re-initialization in Next.js development)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const storage = getStorage(app);

// Analytics is only available in browser environment
// let analytics;
// if (typeof window !== 'undefined') {
//   analytics = getAnalytics(app);
// }

export { app, auth, storage };
