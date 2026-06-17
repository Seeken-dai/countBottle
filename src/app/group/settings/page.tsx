"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch } from "firebase/firestore";
import { ThemeToggle } from "@/components/theme-toggle";
import { Suspense } from "react";

interface InterestConfig {
  rate: number | string;
  type: "none" | "simple" | "compound";
  frequency: "none" | "daily" | "weekly" | "monthly" | "yearly";
  lastCalculatedAt?: any;
}

function GroupSettingsContent() {
  const searchParams = useSearchParams();
  const groupId = searchParams.get("id") as string;
  const { user } = useAuth();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [groupName, setGroupName] = useState("");
  const [groupUnit, setGroupUnit] = useState("");
  const [announcementText, setAnnouncementText] = useState("");
  const [interestConfig, setInterestConfig] = useState<InterestConfig>({
    rate: 0,
    type: "none",
    frequency: "none"
  });

  const [members, setMembers] = useState<any[]>([]);

  useEffect(() => {
    const fetchAuthAndData = async () => {
      if (!user) return;
      
      const groupRef = doc(db, "Groups", groupId);
      const groupSnap = await getDoc(groupRef);
      if (groupSnap.exists()) {
        const data = groupSnap.data();
        if (data.creatorId !== user.uid) {
          alert("你没有权限访问设置页 (仅创建者可用)");
          router.push(`/group/detail?id=${groupId}`);
          return;
        }
        setIsAdmin(true);
        setGroupName(data.name || "");
        setGroupUnit(data.unit || "瓶");
        setAnnouncementText(data.announcement || "");
        if (data.interestConfig) {
          setInterestConfig(data.interestConfig);
        }

        // Fetch all members
        const membersQuery = query(collection(db, "Members"), where("groupId", "==", groupId));
        const membersSnap = await getDocs(membersQuery);
        const fetchedMembers = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setMembers(fetchedMembers);
      } else {
        router.push("/dashboard");
      }
      setIsLoading(false);
    };

    fetchAuthAndData();
  }, [groupId, user, router]);

  const handleSaveBasic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim() || !groupUnit.trim()) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, "Groups", groupId), {
        name: groupName.trim(),
        unit: groupUnit.trim(),
        announcement: announcementText.trim()
      });
      alert("基础设置已保存");
    } catch (err) { alert("保存失败"); }
    finally { setIsSaving(false); }
  };

  const handleSaveInterest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateDoc(doc(db, "Groups", groupId), {
        interestConfig: {
          ...interestConfig,
          rate: Number(interestConfig.rate) || 0,
          // Initialize lastCalculatedAt if activating interest for the first time
          lastCalculatedAt: interestConfig.type !== "none" && !interestConfig.lastCalculatedAt 
            ? new Date() 
            : interestConfig.lastCalculatedAt || null
        }
      });
      alert("计息设置已保存");
    } catch (err) { alert("保存失败"); }
    finally { setIsSaving(false); }
  };

  const handleDeleteGroup = async () => {
    if (!confirm("⚠️ 极度危险操作：确认要解散该群组吗？所有成员及其账目记录将被永久删除且不可恢复！")) return;
    
    // Require user to type group name to confirm
    const confirmName = prompt(`请输入群组名称「${groupName}」以确认解散：`);
    if (confirmName !== groupName) {
      alert("名称不匹配，取消操作。");
      return;
    }

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      
      // Delete Members
      const membersQuery = query(collection(db, "Members"), where("groupId", "==", groupId));
      const membersSnap = await getDocs(membersQuery);
      membersSnap.forEach(d => batch.delete(d.ref));

      // Delete Records
      const recordsQuery = query(collection(db, "Records"), where("groupId", "==", groupId));
      const recordsSnap = await getDocs(recordsQuery);
      recordsSnap.forEach(d => batch.delete(d.ref));

      // Delete Group
      batch.delete(doc(db, "Groups", groupId));

      await batch.commit();
      router.push("/dashboard");
    } catch (err) {
      alert("删除失败");
      setIsSaving(false);
    }
  };

  const renderPreview = () => {
    if (interestConfig.type === "none" || interestConfig.frequency === "none" || Number(interestConfig.rate) <= 0) {
      return <p className="text-sm text-gray-500">当前未开启计息，或参数未配置完整。</p>;
    }

    let balances = [10];
    const rate = (Number(interestConfig.rate) || 0) / 100;
    
    for (let i = 1; i <= 6; i++) {
      let prev = balances[i-1];
      if (interestConfig.type === "simple") {
        // Simple interest: base is always 10
        balances.push(prev + 10 * rate);
      } else {
        // Compound interest
        balances.push(prev + prev * rate);
      }
    }

    return (
      <div className="mt-4 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
        <h5 className="text-sm font-bold text-gray-900 dark:text-white mb-3">预览 (基于当前设置)</h5>
        <div className="grid grid-cols-7 gap-2 text-center text-xs">
          <div className="font-bold text-gray-500">初始</div>
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="font-bold text-gray-500">第 {i} 期</div>)}
          
          <div className="text-gray-900 dark:text-white font-mono">10.00</div>
          {balances.slice(1).map((b, i) => (
            <div key={i} className="text-primary font-mono font-bold">{b.toFixed(2)}</div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3 text-center">注：推演结果仅供参考，实际计算将根据设定频率通过“懒加载”在用户访问时结算。</p>
      </div>
    );
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>;
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-300 pb-20">
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md shadow-sm border-b border-gray-200 dark:border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push(`/group/detail?id=${groupId}`)} className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">群组设置</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        
        {/* Basic Settings */}
        <section className="bg-white dark:bg-gray-900 rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white mb-6 flex items-center">
            <span className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center mr-3">⚙️</span>
            基础设置
          </h2>
          <form onSubmit={handleSaveBasic} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">群组名称</label>
              <input type="text" required value={groupName} onChange={e => setGroupName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-primary outline-none transition-all" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">记账单位</label>
              <input type="text" required value={groupUnit} onChange={e => setGroupUnit(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-primary outline-none transition-all" />
              <p className="text-xs text-gray-500 mt-2">修改单位后，群组看板和成员详情页将立刻生效。</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">群组公告</label>
              <textarea value={announcementText} onChange={e => setAnnouncementText(e.target.value)} rows={3} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-primary outline-none transition-all resize-none" placeholder="选填，写点给群成员看的话吧..." />
            </div>
            <button type="submit" disabled={isSaving} className="w-full py-3 rounded-xl font-bold text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-50">
              保存基础设置
            </button>
          </form>
        </section>

        {/* Sub-Admin Settings */}
        <section className="bg-white dark:bg-gray-900 rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white mb-6 flex items-center">
            <span className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center mr-3">🛡️</span>
            子管理员配置
          </h2>
          <p className="text-sm text-gray-500 mb-6">子管理员可以协助你记账、核销、以及拉新人，但无法解散群组、强制解绑、或修改基础规则。</p>
          
          <div className="space-y-3">
            {members.filter(m => m.userId && m.userId !== user?.uid).length === 0 ? (
              <div className="text-center py-6 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-gray-400 text-sm">暂无可配置的成员（需等对方认领身份后才能设置为管理员）</div>
            ) : (
              members.filter(m => m.userId && m.userId !== user?.uid).map(m => (
                <div key={m.id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center text-lg font-bold text-gray-500 dark:text-gray-400 overflow-hidden shrink-0">
                      {m.photoURL ? <img src={m.photoURL} alt="avatar" className="w-full h-full object-cover" /> : m.remarkName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white">{m.remarkName}</h4>
                      <p className="text-xs text-gray-500 mt-0.5">{m.role === "SUB_ADMIN" ? "子管理员" : "普通成员"}</p>
                    </div>
                  </div>
                  <button 
                    onClick={async () => {
                      const newRole = m.role === "SUB_ADMIN" ? "MEMBER" : "SUB_ADMIN";
                      await updateDoc(doc(db, "Members", m.id), { role: newRole });
                      setMembers(members.map(x => x.id === m.id ? { ...x, role: newRole } : x));
                    }}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${m.role === "SUB_ADMIN" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 hover:bg-purple-200" : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                  >
                    {m.role === "SUB_ADMIN" ? "取消管理" : "设为管理"}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Interest Settings */}
        <section className="bg-white dark:bg-gray-900 rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl" />
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white mb-6 flex items-center relative z-10">
            <span className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center mr-3">📈</span>
            计息规则 (自动结算)
          </h2>
          <form onSubmit={handleSaveInterest} className="space-y-5 relative z-10">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">计算类型</label>
                <select value={interestConfig.type} onChange={e => setInterestConfig({...interestConfig, type: e.target.value as any})} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-primary outline-none transition-all">
                  <option value="none">无利息 (关闭)</option>
                  <option value="simple">单利 (仅按本金)</option>
                  <option value="compound">复利 (利滚利)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">计算频率</label>
                <select value={interestConfig.frequency} onChange={e => setInterestConfig({...interestConfig, frequency: e.target.value as any})} disabled={interestConfig.type === "none"} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-primary outline-none transition-all disabled:opacity-50">
                  <option value="none">暂不执行</option>
                  <option value="daily">每日</option>
                  <option value="weekly">每周</option>
                  <option value="monthly">每月</option>
                  <option value="yearly">每年</option>
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">每期利率 (%)</label>
              <input type="number" min="0" step="0.1" value={interestConfig.rate} onChange={e => setInterestConfig({...interestConfig, rate: e.target.value === '' ? '' : e.target.value})} disabled={interestConfig.type === "none"} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-primary outline-none transition-all disabled:opacity-50" />
            </div>

            {renderPreview()}

            <button type="submit" disabled={isSaving} className="w-full py-3 rounded-xl font-bold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50">
              保存计息规则
            </button>
          </form>
        </section>

        {/* Danger Zone */}
        <section className="bg-red-50/50 dark:bg-red-900/10 rounded-3xl p-6 md:p-8 border border-red-100 dark:border-red-900/30">
          <h2 className="text-xl font-extrabold text-red-600 dark:text-red-400 mb-2 flex items-center">
            <span className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center mr-3">⚠️</span>
            危险区域
          </h2>
          <p className="text-sm text-red-500/80 dark:text-red-400/80 mb-6">以下操作不可逆，请谨慎使用。</p>
          
          <div className="flex flex-col sm:flex-row items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-2xl border border-red-100 dark:border-red-900/30 gap-4">
            <div>
              <h4 className="font-bold text-gray-900 dark:text-white">解散群组</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">删除群组信息、所有成员卡片及所有流水记录。</p>
            </div>
            <button onClick={handleDeleteGroup} disabled={isSaving} className="shrink-0 px-6 py-2.5 rounded-xl font-bold text-red-600 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50">
              彻底解散
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function GroupSettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <GroupSettingsContent />
    </Suspense>
  );
}
