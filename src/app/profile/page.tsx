"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { proxyRequest } from "@/lib/useFirestore";

function getInitial(name?: string | null, email?: string | null) {
  return (name || email?.split("@")[0] || "U").trim().charAt(0).toUpperCase();
}

export default function ProfilePage() {
  const { user, mutateUser } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || "");
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsLoading(true);
    try {
      await proxyRequest({
        action: "updateProfile",
        data: {
          displayName: displayName.trim(),
        },
      });

      mutateUser();
      alert("个人资料已保存");
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
            <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-primary/15 to-blue-500/15 dark:from-primary/25 dark:to-blue-500/20 flex items-center justify-center text-3xl font-black text-primary mb-4 shadow-inner border border-primary/10">
              {getInitial(displayName, user.email)}
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{user.email}</h2>
            <div className="mt-2 text-xs font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 px-3 py-1.5 rounded-lg flex items-center gap-2 border border-gray-200 dark:border-gray-700">
              UID: {user.uid}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  navigator.clipboard.writeText(user.uid);
                  alert("UID 已复制");
                }}
                className="text-primary hover:text-primary/80 font-bold ml-1"
              >
                复制
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-3 text-center">
              系统会根据你的昵称或邮箱首字生成头像，并同步展示到群组成员卡片中。
            </p>
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
              disabled={isLoading}
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
