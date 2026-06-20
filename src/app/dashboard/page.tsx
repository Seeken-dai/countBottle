"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { AppFooter } from "@/components/app-footer";
import Link from "next/link";
import useSWR from 'swr';

interface Group {
  id: string;
  name: string;
  unit: string;
  createdAt: any;
  role?: string;
  myBalance?: number;
}

interface Member {
  id: string;
  groupId: string;
  role: string;
  balance: number;
}

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function DashboardPage() {
  const { user, mutateUser } = useAuth();
  const router = useRouter();
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupUnit, setNewGroupUnit] = useState("瓶");
  const [isCreating, setIsCreating] = useState(false);

  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinGroupId, setJoinGroupId] = useState("");

  const { data, error, mutate } = useSWR(user ? '/api/groups' : null, fetcher, { refreshInterval: 60_000, refreshWhenHidden: false, revalidateOnFocus: true });
  const groups = (data?.groups || []) as Group[];
  const isSuperAdmin = data?.isSuperAdmin || false;
  const isLoadingGroups = !data && !error && !!user;

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    mutateUser();
    router.push("/login");
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newGroupName.trim()) return;

    setIsCreating(true);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName.trim(),
          currency: newGroupUnit.trim() || "个",
        }),
      });

      if (!res.ok) throw new Error("Failed to create group");

      setIsCreateModalOpen(false);
      setNewGroupName("");
      setNewGroupUnit("瓶");
      mutate(); // Refresh the SWR data
    } catch (err) {
      console.error("Error creating group:", err);
      alert("创建失败，请重试");
    } finally {
      setIsCreating(false);
    }
  };

  const navigateToGroup = (groupId: string) => {
    router.push(`/group/detail?id=${groupId}`);
  };

  const handleJoinGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinGroupId.trim()) return;
    router.push(`/group/detail?id=${joinGroupId.trim()}`);
  };

  if (!user) return null; // Avoid flicker before redirect

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black transition-colors duration-300 flex flex-col">
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md shadow-sm border-b border-gray-200 dark:border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
              <span className="text-white font-black text-xl tracking-tighter">聚</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">小聚记账</h1>
          </div>
          <div className="flex items-center gap-4">
            {isSuperAdmin && (
              <Link href="/admin" className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-sm font-bold hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors">
                <span>👑</span>
                超管后台
              </Link>
            )}
            <ThemeToggle />
            <div className="flex items-center gap-3 border-l pl-4 border-gray-200 dark:border-gray-700">
              <Link href="/profile" className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2 hover:text-primary transition-colors cursor-pointer">
                <div className="w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center overflow-hidden shrink-0 border border-gray-300 dark:border-gray-600">
                  {(user.displayName || user.email || "U").charAt(0).toUpperCase()}
                </div>
                <span className="hidden sm:inline-block">{user.displayName || user.email?.split('@')[0]}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="text-sm px-3 py-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
          <div>
            <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">我的群组</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              选择一个群组开始记账，或者创建新的群组
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setIsJoinModalOpen(true)}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-all focus:ring-2 focus:ring-offset-2 focus:ring-gray-200 dark:focus:ring-offset-black"
            >
              加入群组
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl font-semibold text-white bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30 transition-all focus:ring-2 focus:ring-offset-2 focus:ring-primary dark:focus:ring-offset-black"
            >
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              创建新群组
            </button>
          </div>
        </div>

        {isLoadingGroups ? (
          <div className="flex justify-center items-center h-48">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {groups.map((group) => (
              <div
                key={group.id}
                onClick={() => navigateToGroup(group.id)}
                className="group relative bg-white dark:bg-gray-900 rounded-3xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-xl hover:border-primary/50 dark:hover:border-primary/50 transition-all cursor-pointer overflow-hidden"
              >
                {/* Decorative blob inside card */}
                <div className="absolute -right-8 -top-8 w-24 h-24 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-all" />
                
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white truncate pr-4">
                    {group.name}
                  </h3>
                  {group.role === "ADMIN" && (
                    <span className="shrink-0 px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-lg">
                      群主/管理
                    </span>
                  )}
                </div>
                
                <div className="flex items-end justify-between relative z-10 mt-6">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">我的余额</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black text-gray-900 dark:text-white leading-none">
                        {group.myBalance}
                      </span>
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        {group.unit}
                      </span>
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center group-hover:bg-primary group-hover:text-white text-gray-400 transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            ))}

            <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-3xl h-[180px] flex flex-col items-center justify-center gap-3 p-4">
              <button onClick={() => setIsCreateModalOpen(true)} className="w-full py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-primary hover:text-white dark:hover:bg-primary transition-colors">
                + 创建新群组
              </button>
              <button onClick={() => setIsJoinModalOpen(true)} className="w-full py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                输入群组 ID 加入
              </button>
            </div>
          </div>
        )}
      </main>

      <AppFooter />

      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => !isCreating && setIsCreateModalOpen(false)}
        title="创建新群组"
      >
        <form onSubmit={handleCreateGroup} className="space-y-5">
          <div>
            <label htmlFor="groupName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              群组名称
            </label>
            <input
              id="groupName"
              type="text"
              required
              maxLength={20}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="例如：周末德州局 / 办公室奶茶账"
            />
          </div>
          <div>
            <label htmlFor="groupUnit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              记账单位
            </label>
            <input
              id="groupUnit"
              type="text"
              required
              maxLength={5}
              value={newGroupUnit}
              onChange={(e) => setNewGroupUnit(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="例如：瓶、分、杯"
            />
          </div>
          
          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isCreating}
              className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isCreating || !newGroupName.trim()}
              className="flex-1 py-3 px-4 flex justify-center items-center rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isCreating ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                "确认创建"
              )}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isJoinModalOpen}
        onClose={() => setIsJoinModalOpen(false)}
        title="加入群组"
      >
        <form onSubmit={handleJoinGroup} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              群组 ID / 邀请码
            </label>
            <input
              type="text"
              required
              value={joinGroupId}
              onChange={(e) => setJoinGroupId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all"
              placeholder="请输入管理员分享的群组 ID"
            />
          </div>
          
          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={() => setIsJoinModalOpen(false)}
              className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!joinGroupId.trim()}
              className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-70"
            >
              前往认领
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
