"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { auth, db, storage } from "@/lib/firebase";
import { updateProfile } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { ThemeToggle } from "@/components/theme-toggle";

export default function ProfilePage() {
  const { user } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [photoURL, setPhotoURL] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || "");
      setPhotoURL(user.photoURL || "");
    }
  }, [user]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    
    if (file.size > 5 * 1024 * 1024) {
      alert("图片过大，请选择5MB以内的图片");
      return;
    }

    setIsUploading(true);
    const storageRef = ref(storage, `avatars/${user.uid}/${Date.now()}_${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on('state_changed', 
      (snapshot) => {
        // You could track progress here if needed
      }, 
      (error) => {
        console.error("上传失败:", error);
        alert("图片上传失败，请检查 Firebase Storage 权限设置");
        setIsUploading(false);
      }, 
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        setPhotoURL(downloadURL);
        setIsUploading(false);
      }
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (isUploading) {
      alert("图片正在上传中，请稍后...");
      return;
    }
    setIsLoading(true);
    
    try {
      await updateProfile(user, {
        displayName: displayName.trim(),
        photoURL: photoURL.trim()
      });

      await setDoc(doc(db, "Users", user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: displayName.trim(),
        photoURL: photoURL.trim(),
        updatedAt: new Date()
      }, { merge: true });

      alert("个人资料保存成功！");
      router.push("/dashboard");
    } catch (err) {
      alert("保存失败，请重试");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black transition-colors duration-300">
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md shadow-sm border-b border-gray-200 dark:border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/dashboard")} className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">个人资料</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
          <div className="flex flex-col items-center mb-8">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="relative w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-3xl font-bold text-gray-400 overflow-hidden mb-4 shadow-inner cursor-pointer group hover:ring-4 hover:ring-primary/20 transition-all"
            >
              {isUploading ? (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white z-10">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  点击上传
                </div>
              )}
              {photoURL ? (
                <img src={photoURL} alt="Avatar" className="w-full h-full object-cover relative z-0" />
              ) : (
                <span className="relative z-0">{(displayName || user.email?.split('@')[0] || "U").charAt(0).toUpperCase()}</span>
              )}
            </div>
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
            />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{user.email}</h2>
            <div className="mt-2 text-xs font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 px-3 py-1.5 rounded-lg flex items-center gap-2 border border-gray-200 dark:border-gray-700">
              UID: {user.uid}
              <button 
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  navigator.clipboard.writeText(user.uid);
                  alert("UID 已复制！");
                }}
                className="text-primary hover:text-primary/80 font-bold ml-1"
              >
                复制
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">系统会自动同步你的昵称和头像到群组中</p>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                昵称
              </label>
              <input
                type="text"
                maxLength={20}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-primary outline-none transition-all"
                placeholder="你想在卡片上展示的名字"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || isUploading}
              className="w-full py-3.5 rounded-xl font-bold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50 mt-4"
            >
              {isLoading ? "保存中..." : "保存个人资料"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
