"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDocProxy, proxyRequest, queryProxy, updateDocProxy } from "@/lib/useFirestore";
import { ThemeToggle } from "@/components/theme-toggle";
import { Modal } from "@/components/ui/modal";
import { AppFooter } from "@/components/app-footer";
import Link from "next/link";
import { motion, AnimatePresence, useSpring, useTransform } from "framer-motion";
import { Suspense } from "react";

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 300, damping: 30 });
  const display = useTransform(spring, (current) => Math.round(current).toString());

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span>{display}</motion.span>;
}

interface Group {
  id: string;
  name: string;
  unit: string;
  creatorId?: string;
  requireClaimApproval?: boolean;
  interestConfig?: {
    rate: number;
    type: "none" | "simple" | "compound";
    frequency: "none" | "daily" | "weekly" | "monthly" | "yearly";
    lastCalculatedAt?: any;
  };
  announcement?: string;
}

interface Member {
  id: string;
  groupId: string;
  userId: string | null;
  role: string;
  remarkName: string;
  balance: number;
  createdAt: any;
  displayName?: string;
  photoURL?: string;
}

interface Record {
  id: string;
  memberId: string;
  operatorId: string;
  type: "ADD" | "DEDUCT" | "SET" | "INTEREST";
  amount: number;
  createdAt?: any;
  totalAdded?: number;
  note?: string;
}

interface ClaimRequest {
  id: string;
  memberId: string;
  requesterId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

type SortOption = "time" | "name" | "balance";

function getTimeValue(value: any) {
  if (!value) return 0;
  if (typeof value === "string") return new Date(value).getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value._seconds === "number") return value._seconds * 1000;
  return 0;
}

function GroupDetailsContent() {
  const searchParams = useSearchParams();
  const groupId = searchParams.get("id") as string;
  const { user } = useAuth();
  const router = useRouter();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>("time");
  
  const [floaters, setFloaters] = useState<{id: number, memberId: string}[]>([]);

  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [isActionLoading, setIsActionLoading] = useState(false);

  const captureRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [activeMember, setActiveMember] = useState<Member | null>(null);

  useEffect(() => {
    if (selectedMemberId) {
      const m = members.find(m => m.id === selectedMemberId);
      if (m) setActiveMember(m);
    }
  }, [selectedMemberId, members]);

  const selectedMember = activeMember;
  
  const [memberRecords, setMemberRecords] = useState<Record[]>([]);
  const [groupRecords, setGroupRecords] = useState<Record[]>([]);
  const [recordActionType, setRecordActionType] = useState<"ADD" | "DEDUCT" | "SET">("ADD");
  const [recordAmount, setRecordAmount] = useState<string>("");
  const [recordNote, setRecordNote] = useState<string>("");
  const [editRemarkName, setEditRemarkName] = useState("");
  const [pendingClaimMemberIds, setPendingClaimMemberIds] = useState<Set<string>>(new Set());

  // LAZY EVALUATION FOR INTEREST
  const triggerLazyInterest = async (groupData: Group) => {
    if (!groupData.interestConfig || groupData.interestConfig.type === "none" || groupData.interestConfig.frequency === "none" || !groupData.interestConfig.lastCalculatedAt) {
      return;
    }
    try {
      await proxyRequest({ action: "transaction_interest", docId: groupId });
    } catch (err) {
      console.error("Lazy evaluation failed:", err);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const fetchGroupData = async () => {
      const groupData = await getDocProxy("Groups", groupId) as Group | null;
      if (cancelled) return;
      if (groupData) {
        const normalizedGroup = { ...groupData, unit: groupData.unit || (groupData as any).currency || "瓶" };
        setGroup(normalizedGroup);
        triggerLazyInterest(normalizedGroup);
      } else {
        alert("群组不存在");
        router.push("/dashboard");
      }
    }

    const fetchMembers = async () => {
      const memberDocs = await queryProxy("Members", [["groupId", "==", groupId]]) as Member[];
      const resolvedMembers = await Promise.all(memberDocs.map(async (m) => {
        if (m.userId) {
          const uData = await getDocProxy("Users", m.userId);
          if (uData) {
            return { ...m, displayName: uData.displayName };
          }
        }
        return m;
      }));
      if (cancelled) return;
      setMembers(resolvedMembers);
    };

    const fetchRecords = async () => {
      const recs = await queryProxy("Records", [["groupId", "==", groupId]]) as Record[];
      if (cancelled) return;
      setGroupRecords(recs);
    };

    const refresh = () => {
      fetchGroupData();
      fetchMembers();
      fetchRecords();
    };
    refresh();
    const interval = window.setInterval(refresh, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [groupId, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const fetchSortPreference = async () => {
      const userDoc = await getDocProxy("Users", user.uid);
      const preferredSort = userDoc?.groupMemberSortOption as SortOption | undefined;
      if (!cancelled && (preferredSort === "time" || preferredSort === "name" || preferredSort === "balance")) {
        setSortOption(preferredSort);
      }
    };

    fetchSortPreference();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user || !groupId) return;
    let cancelled = false;

    const fetchPendingClaims = async () => {
      const claims = await queryProxy("ClaimRequests", [["groupId", "==", groupId], ["requesterId", "==", user.uid], ["status", "==", "PENDING"]]) as ClaimRequest[];
      if (!cancelled) setPendingClaimMemberIds(new Set(claims.map(claim => claim.memberId)));
    };

    fetchPendingClaims();
    const interval = window.setInterval(fetchPendingClaims, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [groupId, user]);

  useEffect(() => {
    if (!selectedMemberId) {
      return;
    }
    let cancelled = false;
    const fetchMemberRecords = async () => {
      const recs = await queryProxy("Records", [["memberId", "==", selectedMemberId]]) as Record[];
      recs.sort((a, b) => getTimeValue(b.createdAt) - getTimeValue(a.createdAt));
      if (!cancelled) setMemberRecords(recs);
    };
    fetchMemberRecords();
    const interval = window.setInterval(fetchMemberRecords, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedMemberId]);

  const currentUserMember = members.find(m => m.userId === user?.uid);
  const isCreator = group?.creatorId === user?.uid || (group as any)?.createdBy === user?.uid;
  const isSubAdmin = currentUserMember?.role === "SUB_ADMIN" || currentUserMember?.role === "ADMIN" || currentUserMember?.role === "OWNER";
  const isAdmin = isCreator || isSubAdmin;
  const hasClaimed = !!currentUserMember;

  const remainingTotal = members.reduce((sum, m) => sum + m.balance, 0);
  
  const cumulativeTotal = useMemo(() => {
    let total = 0;
    members.forEach(member => {
      const memberRecs = groupRecords.filter(r => r.memberId === member.id);
      memberRecs.sort((a, b) => getTimeValue(a.createdAt) - getTimeValue(b.createdAt));
      
      let runningBalance = 0;
      let memberTotalAdded = 0;

      memberRecs.forEach(record => {
        if (record.type === "ADD") {
          runningBalance += record.amount;
          memberTotalAdded += record.amount;
        } else if (record.type === "DEDUCT") {
          runningBalance -= record.amount;
        } else if (record.type === "INTEREST") {
          runningBalance += record.amount;
          memberTotalAdded += record.amount;
        } else if (record.type === "SET") {
          if (record.amount > runningBalance) {
            memberTotalAdded += (record.amount - runningBalance);
          }
          runningBalance = record.amount;
        }
      });

      if (memberTotalAdded === 0 && member.balance > 0) {
        memberTotalAdded = member.balance;
      }
      
      total += memberTotalAdded;
    });
    return total;
  }, [groupRecords, members]);

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      if (sortOption === "name") return a.remarkName.localeCompare(b.remarkName, 'zh-Hans-CN-u-co-pinyin', { sensitivity: "base", numeric: true });
      if (sortOption === "balance") return b.balance - a.balance;
      const timeA = getTimeValue(a.createdAt);
      const timeB = getTimeValue(b.createdAt);
      return timeA - timeB;
    });
  }, [members, sortOption]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newMemberName.trim()) return;
    setIsActionLoading(true);
    try {
      await proxyRequest({ action: "addMember", data: { groupId, remarkName: newMemberName.trim() } });
      setIsAddMemberModalOpen(false);
      setNewMemberName("");
    } catch (err) { alert("添加成员失败"); } finally { setIsActionLoading(false); }
  };

  const handleSortChange = async (nextSort: SortOption) => {
    setSortOption(nextSort);
    if (user) {
      try {
        await updateDocProxy("Users", user.uid, { groupMemberSortOption: nextSort });
      } catch (err) {
        console.error("Failed to save sort preference:", err);
      }
    }
  };

  const selectRecordActionType = (nextType: "ADD" | "DEDUCT" | "SET") => {
    setRecordActionType(nextType);
    setRecordAmount("");
    setRecordNote("");
  };

  const handleClaim = async (memberId: string, memberName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    if (hasClaimed) { alert("你已经在该群组中拥有身份了，无法重复认领。"); return; }
    if (!confirm(`确认要认领身份「${memberName}」吗？`)) return;
    try {
      const result = await proxyRequest({ action: "requestClaim", data: { groupId, memberId } }) as { status?: string };
      if (result?.status === "PENDING") {
        setPendingClaimMemberIds(prev => new Set(prev).add(memberId));
        alert("认领申请已提交，等待管理员审核。");
      }
    } catch (err: any) { alert(err.message || "认领失败"); }
  };

  const generateImage = async () => {
    if (!captureRef.current) return;
    setIsGenerating(true);
    try {
      const htmlToImage = await import('html-to-image');
      const dataUrl = await htmlToImage.toPng(captureRef.current, {
        pixelRatio: 2,
        backgroundColor: document.documentElement.classList.contains('dark') ? '#000000' : '#f9fafb',
        cacheBust: true
      });
      setPreviewImage(dataUrl);
    } catch (err: any) {
      console.error(err);
      alert("生成图片失败: " + (err.message || String(err)));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleQuickAdd = async (memberId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    
    const floatId = Date.now();
    setFloaters(prev => [...prev, { id: floatId, memberId }]);
    setTimeout(() => {
      setFloaters(prev => prev.filter(f => f.id !== floatId));
    }, 1000);

    try {
      await proxyRequest({ action: "quickAddRecord", data: { groupId, memberId } });
    } catch (err) { alert("操作失败"); }
  };

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember || !user) return;
    const amount = parseInt(recordAmount, 10);
    if (isNaN(amount) || amount < 0) { alert("请输入有效的非负整数"); return; }

    setIsActionLoading(true);
    
    try {
      await proxyRequest({
        action: "submitRecord",
        data: {
          groupId,
          memberId: selectedMember.id,
          recordActionType,
          amount,
          note: recordNote.trim()
        }
      });
      setRecordAmount("");
      setRecordNote("");
      setSelectedMemberId(null);
    } catch (err: any) { alert(err.message || "操作失败"); } 
    finally { setIsActionLoading(false); }
  };

  const handleEditRemarkName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !selectedMember || !editRemarkName.trim()) return;
    setIsActionLoading(true);
    try {
      await proxyRequest({ action: "updateMemberName", data: { groupId, memberId: selectedMember.id, remarkName: editRemarkName.trim() } });
      setEditRemarkName("");
    } catch (err) { alert("修改失败"); } 
    finally { setIsActionLoading(false); }
  };

  const handleUnbind = async () => {
    if (!isCreator || !selectedMember || !selectedMember.userId) return;
    if (!confirm("确认要强制解绑该成员吗？解绑后卡片将变为空白卡片供重新认领，但流水会保留。")) return;
    try { await proxyRequest({ action: "unbindMember", data: { groupId, memberId: selectedMember.id } }); } 
    catch (err) { alert("解绑失败"); }
  };

  const handleDeleteMember = async () => {
    if (!isCreator || !selectedMember) return;
    if (!confirm("⚠️ 危险操作：确认要删除该成员吗？与其相关的流水可能也会丢失或成为孤儿数据。")) return;
    try {
      await proxyRequest({ action: "deleteMember", data: { groupId, memberId: selectedMember.id } });
      setSelectedMemberId(null);
    } catch (err) { alert("删除失败"); }
  };

  if (!group) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-300 pb-20">
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md shadow-sm border-b border-gray-200 dark:border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/dashboard")} className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">群组详情</h1>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <Link href={`/group/settings?id=${groupId}`} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors" aria-label="Settings">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </Link>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Banner Section */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 sm:p-8 mb-8 text-gray-900 dark:text-white shadow-lg relative overflow-hidden">
          <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-primary/20 rounded-full blur-3xl pointer-events-none"></div>
          <div className="relative z-10">
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3 text-gray-900 dark:text-white">{group.name}</h2>
            <div className="flex flex-wrap items-center gap-3">
              <div 
                className="inline-flex items-center gap-2 text-xs bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 px-3 py-1.5 rounded-lg cursor-pointer transition-colors backdrop-blur-sm text-gray-700 dark:text-gray-200"
                onClick={() => { navigator.clipboard.writeText(groupId); alert("✅ 群组 ID 已复制：" + groupId); }}
              >
                <span className="opacity-80">ID:</span>
                <span className="font-mono tracking-wider">{groupId}</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              </div>
              <div 
                className="inline-flex items-center gap-2 text-xs bg-primary/80 hover:bg-primary px-3 py-1.5 rounded-lg cursor-pointer transition-colors backdrop-blur-sm shadow-lg shadow-primary/20 text-white"
                onClick={() => { navigator.clipboard.writeText(window.location.origin + "/invite?id=" + groupId); alert("✅ 邀请链接已复制，快发给小伙伴吧！"); }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                分享链接
              </div>
              <div 
                className={`inline-flex items-center gap-2 text-xs bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 px-3 py-1.5 rounded-lg cursor-pointer transition-colors backdrop-blur-sm text-gray-700 dark:text-gray-200 ${isGenerating ? 'opacity-50 pointer-events-none' : ''}`}
                onClick={generateImage}
              >
                {isGenerating ? (
                  <div className="w-4 h-4 border-2 border-primary/50 dark:border-white/50 border-t-primary dark:border-t-white rounded-full animate-spin"></div>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                )}
                生成排行长图
              </div>
            </div>

            {group.announcement && (
              <div className="mt-6 p-3.5 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-200 dark:border-white/10 backdrop-blur-sm">
                <div className="flex items-center gap-1.5 mb-2 text-xs text-gray-700 dark:text-white/80 font-bold tracking-widest">
                  <svg className="w-4 h-4 text-gray-500 dark:text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
                  群组公告
                </div>
                <p className="text-[13px] sm:text-sm leading-relaxed whitespace-pre-wrap text-gray-800 dark:text-white/90">
                  {group.announcement}
                </p>
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="bg-gray-50 dark:bg-white/5 backdrop-blur-sm border border-gray-200 dark:border-white/10 rounded-xl p-4">
                <div className="text-xs text-gray-500 dark:text-white/70 mb-1">剩余总数</div>
                <div className="text-2xl font-black text-gray-900 dark:text-white"><AnimatedNumber value={remainingTotal} /> <span className="text-sm font-medium text-gray-500 dark:text-white/70">{group.unit}</span></div>
              </div>
              <div className="bg-gray-50 dark:bg-white/5 backdrop-blur-sm border border-gray-200 dark:border-white/10 rounded-xl p-4">
                <div className="text-xs text-gray-500 dark:text-white/70 mb-1">累计增加</div>
                <div className="text-2xl font-black text-gray-900 dark:text-white"><AnimatedNumber value={cumulativeTotal} /> <span className="text-sm font-medium text-gray-500 dark:text-white/70">{group.unit}</span></div>
              </div>
            </div>
            
            <div className="mt-8 flex flex-wrap items-center gap-4 text-sm opacity-90">
              <div className="flex items-center gap-2 bg-gray-100 dark:bg-black/20 px-3 py-1.5 rounded-lg text-gray-700 dark:text-white">
                <span>📏</span>
                <span>单位：{group.unit}</span>
              </div>
              <div className="flex items-center gap-2 bg-gray-100 dark:bg-black/20 px-3 py-1.5 rounded-lg text-gray-700 dark:text-white">
                <span>📈</span>
                <span>
                  计息：
                  {!group.interestConfig || group.interestConfig.type === 'none' || group.interestConfig.frequency === 'none'
                    ? "未开启" 
                    : `${group.interestConfig.type === 'simple' ? '单利' : '复利'} · ${group.interestConfig.rate}% / ${
                      { daily: '每日', weekly: '每周', monthly: '每月', yearly: '每年' }[group.interestConfig.frequency] || ''
                    }`}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-4">
            <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">群组成员</h2>
            <select value={sortOption} onChange={(e) => handleSortChange(e.target.value as SortOption)} className="bg-transparent border-none text-sm font-medium text-gray-500 dark:text-gray-400 focus:ring-0 outline-none cursor-pointer p-0">
              <option value="time">按加入时间</option>
              <option value="name">按名称</option>
              <option value="balance">按数量</option>
            </select>
          </div>
          {isAdmin && (
            <button onClick={() => setIsAddMemberModalOpen(true)} className="flex items-center justify-center gap-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg font-bold text-sm hover:bg-gray-800 dark:hover:bg-gray-100 transition-all active:scale-95 shadow-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              添加
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {sortedMembers.map((member, index) => {
              const isUnclaimed = !member.userId;
              const isMe = member.userId === user?.uid;
              return (
                <motion.div 
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  key={member.id} 
                  onClick={() => { setSelectedMemberId(member.id); setEditRemarkName(member.remarkName); }} 
                  className={`relative bg-white dark:bg-gray-900 rounded-2xl p-3 sm:p-5 border cursor-pointer hover:border-primary/50 flex flex-row items-center justify-between gap-2 sm:gap-4 ${isMe ? "border-primary shadow-sm shadow-primary/10" : "border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md"} transition-all`}
                >
                  
                  {/* Left: Avatar and Info */}
                  <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-tr from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center text-base sm:text-lg font-bold text-gray-500 dark:text-gray-400 overflow-hidden shrink-0">
                      {(member.displayName || member.remarkName).charAt(0).toUpperCase()}
                    </div>
                    <div className="truncate flex flex-col justify-center">
                      <h3 className="text-sm sm:text-lg font-bold text-gray-900 dark:text-white flex items-center gap-1.5 sm:gap-2 truncate">
                        {index + 1}. {member.remarkName}
                        {isMe && <span className="px-1.5 py-0.5 text-[10px] font-black bg-primary text-white rounded-md shrink-0">我</span>}
                        {isUnclaimed && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded-md shrink-0">未认领</span>}
                      </h3>
                      {member.displayName && member.displayName !== member.remarkName && <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 truncate">{member.displayName}</p>}
                    </div>
                  </div>

                  {/* Right: Balance and Actions */}
                  <div className="flex items-center justify-end gap-3 sm:gap-6 shrink-0">
                    <div className="text-right flex flex-col justify-center">
                      <div className="hidden sm:block text-xs text-gray-500 dark:text-gray-400 mb-0.5">当前数量</div>
                      <div className="flex items-baseline gap-0.5 sm:gap-1">
                        <span className="text-xl sm:text-3xl font-black text-gray-900 dark:text-white leading-none"><AnimatedNumber value={member.balance} /></span>
                        <span className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400">{group.unit}</span>
                      </div>
                    </div>
                    
                    <div className="w-12 sm:w-16 flex justify-end shrink-0 relative">
                      {isAdmin && (
                        <button onClick={(e) => handleQuickAdd(member.id, e)} className="relative z-10 w-10 h-8 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-primary text-white font-black text-base sm:text-lg hover:bg-primary/90 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/30 transition-all active:scale-95 flex items-center justify-center">+1</button>
                      )}
                      {isUnclaimed && !hasClaimed && (
                        pendingClaimMemberIds.has(member.id) ? (
                          <span className="px-2 h-8 sm:px-3 sm:h-12 rounded-lg sm:rounded-xl bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 text-[10px] sm:text-xs font-bold flex items-center justify-center">待审核</span>
                        ) : (
                          <button onClick={(e) => handleClaim(member.id, member.remarkName, e)} className="px-3 h-8 sm:px-4 sm:h-12 rounded-lg sm:rounded-xl bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-xs sm:text-sm font-bold hover:shadow-lg transition-all active:scale-95">认领</button>
                        )
                      )}
                      {floaters.filter(f => f.memberId === member.id).map(f => (
                        <div key={f.id} className="absolute -top-4 right-1 text-primary dark:text-primary font-black text-2xl animate-float-up pointer-events-none z-0 drop-shadow-sm">+1</div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </main>

      <AppFooter />

      <Modal isOpen={isAddMemberModalOpen} onClose={() => !isActionLoading && setIsAddMemberModalOpen(false)} title="添加新成员 (空白卡片)">
        <form onSubmit={handleAddMember} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">成员备注名</label>
            <input type="text" required maxLength={20} value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all" placeholder="例如：张三" />
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsAddMemberModalOpen(false)} disabled={isActionLoading} className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">取消</button>
            <button type="submit" disabled={isActionLoading || !newMemberName.trim()} className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors">确认添加</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!selectedMemberId} onClose={() => setSelectedMemberId(null)} title="成员详情与账目记录" maxWidth="xl">
        {selectedMember && (
          <div className="space-y-6">
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-2xl flex justify-between items-center">
              <div>
                <h4 className="text-lg font-bold text-gray-900 dark:text-white">{selectedMember.remarkName}</h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">当前余额: <span className="font-black text-gray-900 dark:text-white text-lg"><AnimatedNumber value={selectedMember.balance} /></span> {group.unit}</p>
              </div>
              <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center font-bold text-gray-600 dark:text-gray-300">{selectedMember.remarkName.charAt(0)}</div>
            </div>

            {(isAdmin || selectedMember.userId === user?.uid) && (
              <form onSubmit={handleRecordSubmit} className="min-w-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 rounded-2xl shadow-sm space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => selectRecordActionType("ADD")} className={`min-w-0 px-2 py-2 text-xs sm:text-sm leading-tight font-bold rounded-lg transition-colors ${recordActionType === "ADD" ? "bg-primary text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"}`}>记一笔 (+)</button>
                  {isAdmin && <button type="button" onClick={() => selectRecordActionType("DEDUCT")} className={`min-w-0 px-2 py-2 text-xs sm:text-sm leading-tight font-bold rounded-lg transition-colors ${recordActionType === "DEDUCT" ? "bg-orange-500 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"}`}>核销 (-)</button>}
                  {isAdmin && <button type="button" onClick={() => selectRecordActionType("SET")} className={`min-w-0 px-2 py-2 text-xs sm:text-sm leading-tight font-bold rounded-lg transition-colors ${recordActionType === "SET" ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"}`}>强制调平 (=)</button>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3">
                  <input type="number" required min={0} value={recordAmount} onChange={(e) => setRecordAmount(e.target.value)} placeholder="输入数量" className="w-full min-w-0 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 outline-none focus:ring-2 focus:ring-primary text-base" />
                </div>
                <textarea value={recordNote} onChange={(e) => setRecordNote(e.target.value)} maxLength={200} rows={2} placeholder="备注（可选）" className="w-full min-w-0 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 outline-none focus:ring-2 focus:ring-primary text-base resize-none" />
                <button type="submit" disabled={isActionLoading || !recordAmount} className="w-full min-h-11 px-6 rounded-xl font-bold text-white bg-primary disabled:opacity-50">提交</button>
              </form>
            )}

            <div>
              <h5 className="font-bold text-gray-900 dark:text-white mb-3">流水记录</h5>
              <div className="max-h-60 overflow-y-auto space-y-3 pr-2">
                {memberRecords.length === 0 ? <p className="text-sm text-gray-500 text-center py-4">暂无流水记录</p> : (
                  memberRecords.map(record => (
                    <div key={record.id} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-gray-100 dark:border-gray-800">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {record.type === "ADD" && "增加"}
                          {record.type === "DEDUCT" && "核销"}
                          {record.type === "SET" && "强制调平为"}
                          {record.type === "INTEREST" && "自动计息"}
                        </span>
                        <span className="text-xs text-gray-500 mt-1">{record.createdAt ? new Date(getTimeValue(record.createdAt)).toLocaleString() : "刚刚"}</span>
                        {record.note && <span className="text-xs text-gray-500 mt-1 break-words">备注：{record.note}</span>}
                      </div>
                      <span className={`font-black ${record.type === 'DEDUCT' ? 'text-orange-500' : 'text-primary'}`}>
                        {record.type === 'DEDUCT' ? '-' : record.type === 'ADD' || record.type === 'INTEREST' ? '+' : ''}{record.amount}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {isAdmin && (
              <div className="border-t border-gray-200 dark:border-gray-800 pt-6 mt-6">
                <h5 className="font-bold text-gray-900 dark:text-white mb-2">管理员高级操作</h5>
                <p className="text-xs text-gray-500 mb-4">群主及子管理员可用。</p>
                
                <div className="mb-4">
                  <form onSubmit={handleEditRemarkName} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3">
                    <div className="min-w-0">
                      <input type="text" value={editRemarkName} onChange={e => setEditRemarkName(e.target.value)} className="w-full min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 outline-none focus:ring-1 focus:ring-primary text-base sm:text-sm" placeholder="修改备注名" />
                      <p className="text-[11px] text-gray-400 mt-1 ml-1">修改该成员的昵称</p>
                    </div>
                    <button type="submit" disabled={isActionLoading || !editRemarkName} className="w-full sm:w-auto min-h-10 px-4 text-sm font-bold bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg whitespace-nowrap">保存</button>
                  </form>
                </div>
              </div>
            )}

            {isCreator && (
              <div className="border-t border-gray-200 dark:border-gray-800 pt-6 mt-6">
                <h5 className="font-bold text-gray-900 dark:text-white mb-2">群主危险操作</h5>
                <p className="text-xs text-gray-500 mb-4">以下操作仅群主可见。修改将立刻生效，请谨慎操作。</p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <button onClick={handleUnbind} disabled={!selectedMember.userId} className="w-full py-2.5 text-sm font-bold bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50 transition-colors">强制解绑账号</button>
                    <p className="text-[11px] text-gray-400 mt-1.5 leading-tight">将卡片恢复为“未认领”状态。过往账目保留。</p>
                  </div>
                  <div className="min-w-0">
                    <button onClick={handleDeleteMember} className="w-full py-2.5 text-sm font-bold bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors">彻底删除成员</button>
                    <p className="text-[11px] text-red-400/80 mt-1.5 leading-tight">永久销毁该卡片。相关流水记录将变成无主数据。</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal isOpen={!!previewImage} onClose={() => setPreviewImage(null)} title="排行榜长图">
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-gray-500 text-center">长按图片（手机）、右键（电脑）或点击下方按钮下载</p>
          <div className="max-h-[60vh] overflow-y-auto w-full flex justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black p-2">
            {previewImage && <img src={previewImage} alt="群组长图" className="max-w-full h-auto rounded-lg shadow-sm" style={{ objectFit: 'contain' }} />}
          </div>
          <div className="flex gap-3 w-full">
            <button onClick={() => setPreviewImage(null)} className="flex-1 py-3 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-white font-bold hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors">
              关闭
            </button>
            <a href={previewImage || "#"} download={`countbottle-${group?.name || 'group'}-${new Date().toLocaleString('zh-CN', {hour12:false}).replace(/[\/\s:]/g, '')}.png`} className="flex-[2] flex justify-center items-center gap-2 py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/30">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              下载长图
            </a>
          </div>
        </div>
      </Modal>

      {/* Hidden container for image generation */}
      <div style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
        <div ref={captureRef} className="w-[400px] bg-gray-50 dark:bg-gray-950 p-6 flex flex-col gap-6" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          <div className="text-center">
            <h2 className="text-2xl font-black text-gray-900 dark:text-white">{group?.name}</h2>
          </div>
          
          <div className="bg-gray-900 dark:bg-primary/20 rounded-2xl p-4 text-white flex justify-between">
            <div className="text-center flex-1 border-r border-white/10">
              <div className="text-[10px] text-white/60 mb-1">剩余总数 ({group?.unit})</div>
              <div className="text-xl font-black">{remainingTotal}</div>
            </div>
            <div className="text-center flex-1">
              <div className="text-[10px] text-white/60 mb-1">累计增加 ({group?.unit})</div>
              <div className="text-xl font-black">{cumulativeTotal}</div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {sortedMembers.map((member, index) => (
              <div key={member.id} className="bg-white dark:bg-gray-900 rounded-xl p-3 shadow-sm border border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400 overflow-hidden shrink-0">
                    {(member.displayName || member.remarkName).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                      {index + 1}. {member.remarkName}
                    </h3>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-gray-900 dark:text-white">{member.balance}</span>
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-center mt-4">
            <div className="text-[10px] text-gray-400 dark:text-gray-600">由 CountBottle 小聚记账 生成</div>
            <div className="text-[9px] text-gray-300 dark:text-gray-700 mt-1">{new Date().toLocaleString('zh-CN', { hour12: false })}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GroupDetailsPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <GroupDetailsContent />
    </Suspense>
  );
}
