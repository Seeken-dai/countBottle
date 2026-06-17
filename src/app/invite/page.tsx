"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { ThemeToggle } from "@/components/theme-toggle";
import { Suspense } from "react";

function InviteContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") as string;
  const { user, loading } = useAuth();
  const router = useRouter();
  const [groupName, setGroupName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Not logged in, redirect to login with return url
      router.replace(`/login?redirect=/invite?id=${id}`);
      return;
    }

    const fetchGroupAndJoin = async () => {
      try {
        setIsJoining(true);
        // 1. Fetch group
        const groupRef = doc(db, "Groups", id);
        const groupSnap = await getDoc(groupRef);
        
        if (!groupSnap.exists()) {
          setError("群组不存在或已被解散");
          return;
        }
        setGroupName(groupSnap.data().name);

        // 2. Check if already a member
        const q = query(collection(db, "Members"), where("groupId", "==", id), where("userId", "==", user.uid));
        const memberSnaps = await getDocs(q);
        
        if (!memberSnaps.empty) {
          // Already in group, redirect directly
          router.replace(`/group/detail?id=${id}`);
          return;
        }

        // 3. Auto-join: Create member document
        await addDoc(collection(db, "Members"), {
          groupId: id,
          userId: user.uid,
          role: "MEMBER",
          remarkName: user.displayName || user.email?.split("@")[0] || "新成员",
          balance: 0,
          totalAdded: 0,
          createdAt: serverTimestamp()
        });

        // Redirect to group page after successful join
        router.replace(`/group/detail?id=${id}`);
      } catch (err: any) {
        console.error("Join error:", err);
        setError("加入群组失败，请重试");
      } finally {
        setIsJoining(false);
      }
    };

    fetchGroupAndJoin();
  }, [user, loading, id, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-black p-4">
        <div className="bg-white dark:bg-gray-900 p-8 rounded-3xl shadow-xl text-center max-w-sm w-full border border-gray-200 dark:border-gray-800">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">出错了</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">{error}</p>
          <button onClick={() => router.push("/dashboard")} className="w-full py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary/90 transition-colors">
            返回看板
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-black relative overflow-hidden transition-colors duration-300">
      <div className="absolute top-4 right-4 z-50"><ThemeToggle /></div>
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 dark:bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/20 dark:bg-blue-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex flex-col items-center">
        <div className="w-20 h-20 bg-white dark:bg-gray-900 shadow-xl rounded-2xl flex items-center justify-center mb-6 animate-pulse">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {groupName ? `正在加入「${groupName}」...` : "正在准备群组信息..."}
        </h2>
        <p className="text-gray-500 dark:text-gray-400">请稍候，马上带你进入</p>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <InviteContent />
    </Suspense>
  );
}
