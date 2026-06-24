"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { createOperationId, getDocProxy, proxyRequest, queryPageProxy, queryProxy, updateDocProxy } from "@/lib/useFirestore";
import { InfiniteScrollTrigger } from "@/components/infinite-scroll-trigger";
import { startVisibleRefresh } from "@/lib/visible-refresh";
import { ThemeToggle } from "@/components/theme-toggle";
import { Modal } from "@/components/ui/modal";
import Link from "next/link";
import { motion, AnimatePresence, useSpring, useTransform } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Download, LoaderCircle, RotateCcw, Share2, Trophy } from "lucide-react";
import { Suspense } from "react";
import { formatBalanceState, getBalanceView } from "@/lib/balance-display";
import { getErrorMessage } from "@/lib/error-message";
import Image from "next/image";
import type { ProxyWhereClause } from "@/lib/useFirestore";

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
  createdBy?: string;
  currency?: string;
  requireClaimApproval?: boolean;
  creditBalanceStatus?: "disabled" | "enabled" | "disabling";
  interestConfig?: {
    rate: number;
    fixedAmount?: number;
    type: "none" | "simple" | "compound" | "fixed";
    frequency: "none" | "daily" | "weekly" | "monthly" | "yearly";
    nextInterestAt?: unknown;
    lastCalculatedAt?: unknown;
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
  createdAt: unknown;
  totalAdded?: number;
  displayName?: string;
  photoURL?: string;
}

interface LedgerRecord {
  id: string;
  memberId: string;
  operatorId: string;
  type: "ADD" | "DEDUCT" | "SET" | "INTEREST";
  amount: number;
  createdAt?: unknown;
  totalAdded?: number;
  note?: string;
  balanceMode?: "DEBT" | "CREDIT";
  beforeBalance?: number;
  afterBalance?: number;
}

interface ClaimRequest {
  id: string;
  memberId: string;
  requesterId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

interface RankingEntry {
  memberId: string;
  name: string;
  amount: number;
  lastActivityAt: string;
}

interface WeeklyRankings {
  from: string;
  to: string;
  add: RankingEntry[];
  deduct: RankingEntry[];
}

type RankingType = "add" | "deduct";

type SortOption = "time" | "name" | "balance";

function getTimeValue(value: unknown) {
  if (!value) return 0;
  if (typeof value === "string") return new Date(value).getTime();
  if (typeof value !== "object") return 0;
  if ("toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  if ("seconds" in value && typeof value.seconds === "number") return value.seconds * 1000;
  if ("_seconds" in value && typeof value._seconds === "number") return value._seconds * 1000;
  return 0;
}

function RankingPodium({ entries, unit }: { entries: RankingEntry[]; unit: string }) {
  const slots = [entries[1], entries[0], entries[2]];
  const ranks = [2, 1, 3];
  const heights = ["h-20 sm:h-24", "h-28 sm:h-32", "h-16 sm:h-20"];
  const tones = [
    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
  ];

  return (
    <div className="grid grid-cols-3 items-end gap-2 sm:gap-3 pt-5" aria-label="近 7 天前三名">
      {slots.map((entry, index) => entry ? (
        <div key={entry.memberId} className="flex min-w-0 flex-col items-center text-center">
          <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-full text-sm font-black ${tones[index]}`}>
            {ranks[index]}
          </div>
          <div className="mb-2 w-full truncate px-1 text-sm font-bold text-gray-900 dark:text-white" title={entry.name}>
            {entry.name}
          </div>
          <div className={`flex w-full flex-col items-center justify-center rounded-t-xl border border-b-0 border-gray-200 bg-gray-50 px-1 dark:border-gray-700 dark:bg-gray-800/70 ${heights[index]}`}>
            {ranks[index] === 1 && <Trophy className="mb-1 h-5 w-5 text-amber-500" aria-hidden="true" />}
            <span className="max-w-full truncate text-base font-black tabular-nums text-gray-900 dark:text-white">
              {entry.amount}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{unit}</span>
          </div>
        </div>
      ) : <div key={ranks[index]} aria-hidden="true" />)}
    </div>
  );
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
  const floaterIdRef = useRef(0);
  const quickAddLocksRef = useRef(new Set<string>());
  const [pendingQuickAddMemberIds, setPendingQuickAddMemberIds] = useState<Set<string>>(new Set());

  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [isActionLoading, setIsActionLoading] = useState(false);
  const actionLockRef = useRef(false);

  const captureRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewImageFile, setPreviewImageFile] = useState<File | null>(null);
  const [canSharePreviewImage, setCanSharePreviewImage] = useState(false);
  const [isSharingPreviewImage, setIsSharingPreviewImage] = useState(false);

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const selectedMember = selectedMemberId ? members.find((member) => member.id === selectedMemberId) || null : null;
  
  const [memberRecords, setMemberRecords] = useState<LedgerRecord[]>([]);
  const [recordActionType, setRecordActionType] = useState<"ADD" | "DEDUCT" | "SET">("ADD");
  const [recordAmount, setRecordAmount] = useState<string>("");
  const [recordBalanceMode, setRecordBalanceMode] = useState<"DEBT" | "CREDIT">("DEBT");
  const [recordNote, setRecordNote] = useState<string>("");
  const [editRemarkName, setEditRemarkName] = useState("");
  const [pendingClaimMemberIds, setPendingClaimMemberIds] = useState<Set<string>>(new Set());
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [recordOperatorNames, setRecordOperatorNames] = useState<Record<string, string>>({});
  const [refreshToken, setRefreshToken] = useState(0);
  const [memberRecordsHasMore, setMemberRecordsHasMore] = useState(false);
  const [memberRecordsLoading, setMemberRecordsLoading] = useState(false);
  const [memberRecordsError, setMemberRecordsError] = useState<string | null>(null);
  const memberRecordsCursorRef = useRef<string | null>(null);
  const memberRecordsLoadingRef = useRef(false);

  const [weeklyRankings, setWeeklyRankings] = useState<WeeklyRankings | null>(null);
  const [weeklyRankingLoading, setWeeklyRankingLoading] = useState(false);
  const [weeklyRankingError, setWeeklyRankingError] = useState<string | null>(null);
  const [activeRankingType, setActiveRankingType] = useState<RankingType | null>(null);
  const weeklyRankingLoadedGroupRef = useRef<string | null>(null);
  const weeklyRankingRequestRef = useRef(0);

  const memberRecordsRequestRef = useRef(0);

  const loadWeeklyRankings = useCallback(async () => {
    if (!groupId) return;
    const requestId = ++weeklyRankingRequestRef.current;
    setWeeklyRankingLoading(true);
    setWeeklyRankingError(null);
    try {
      const result = await proxyRequest({
        action: "getWeeklyMemberRankings",
        data: { groupId }
      }) as WeeklyRankings;
      if (requestId === weeklyRankingRequestRef.current) setWeeklyRankings(result);
    } catch (error) {
      if (requestId === weeklyRankingRequestRef.current) {
        setWeeklyRankingError(error instanceof Error ? error.message : "排行榜加载失败");
      }
    } finally {
      if (requestId === weeklyRankingRequestRef.current) setWeeklyRankingLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (!groupId || weeklyRankingLoadedGroupRef.current === groupId) return;
    weeklyRankingLoadedGroupRef.current = groupId;
    setWeeklyRankings(null);
    void loadWeeklyRankings();
  }, [groupId, loadWeeklyRankings]);

  // LAZY EVALUATION FOR INTEREST
  const triggerLazyInterest = useCallback(async (groupData: Group) => {
    if (!groupData.interestConfig || groupData.interestConfig.type === "none" || groupData.interestConfig.frequency === "none" || !groupData.interestConfig.nextInterestAt) {
      return;
    }
    try {
      await proxyRequest({ action: "transaction_interest", docId: groupId });
    } catch (err) {
      console.error("Lazy evaluation failed:", err);
    }
  }, [groupId]);

  useEffect(() => {
    let cancelled = false;

    const fetchGroupData = async () => {
      const groupData = await getDocProxy<Group>("Groups", groupId);
      if (cancelled) return;
      if (groupData) {
        const normalizedGroup = { ...groupData, unit: groupData.unit || groupData.currency || "瓶" };
        setGroup(normalizedGroup);
        void triggerLazyInterest(normalizedGroup);
      } else {
        alert("群组不存在");
        router.push("/dashboard");
      }
    }

    const fetchMembers = async () => {
      const memberDocs = await queryProxy<Member>("Members", [["groupId", "==", groupId]]);
      const resolvedMembers = await Promise.all(memberDocs.map(async (m) => {
        if (m.userId) {
          const uData = await getDocProxy<{ displayName?: string }>("Users", m.userId);
          if (uData) {
            return { ...m, displayName: uData.displayName };
          }
        }
        return m;
      }));
      if (cancelled) return;
      setMembers(resolvedMembers);
    };

    const refresh = async () => {
      await Promise.all([fetchGroupData(), fetchMembers()]);
    };
    const stopRefreshing = startVisibleRefresh(refresh);

    return () => {
      cancelled = true;
      stopRefreshing();
    };
  }, [groupId, router, refreshToken, triggerLazyInterest]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const fetchSortPreference = async () => {
      const userDoc = await getDocProxy<{ groupMemberSortOption?: SortOption }>("Users", user.uid);
      const preferredSort = userDoc?.groupMemberSortOption as SortOption | undefined;
      if (!cancelled && (preferredSort === "time" || preferredSort === "name" || preferredSort === "balance")) {
        setSortOption(preferredSort);
      }
    };

    fetchSortPreference();
    return () => { cancelled = true; };
  }, [user]);

  const loadMemberRecords = useCallback(async (reset = false) => {
    if (!selectedMemberId || (memberRecordsLoadingRef.current && !reset)) return;
    if (reset) {
      memberRecordsRequestRef.current += 1;
      memberRecordsLoadingRef.current = false;
      memberRecordsCursorRef.current = null;
      setMemberRecords([]);
      setRecordOperatorNames({});
      setMemberRecordsHasMore(true);
    }

    const requestId = memberRecordsRequestRef.current;
    memberRecordsLoadingRef.current = true;
    setMemberRecordsLoading(true);
    setMemberRecordsError(null);
    try {
      const page = await queryPageProxy<LedgerRecord>(
        "Records",
        [["groupId", "==", groupId], ["memberId", "==", selectedMemberId]],
        ["createdAt", "desc"],
        30,
        memberRecordsCursorRef.current
      );
      if (requestId !== memberRecordsRequestRef.current) return;

      const operatorIds = Array.from(new Set(
        page.docs.map((record) => record.operatorId).filter((id) => id && id !== "SYSTEM")
      ));
      const operatorEntries = await Promise.all(operatorIds.map(async (operatorId) => {
        const operator = await getDocProxy<{ displayName?: string }>("Users", operatorId);
        return [operatorId, operator?.displayName || "未知用户"] as const;
      }));
      if (requestId !== memberRecordsRequestRef.current) return;

      setMemberRecords((previous) => reset
        ? page.docs
        : [...previous, ...page.docs.filter((record) => !previous.some((item) => item.id === record.id))]);
      setRecordOperatorNames((previous) => ({ ...previous, ...Object.fromEntries(operatorEntries) }));
      memberRecordsCursorRef.current = page.nextCursor;
      setMemberRecordsHasMore(page.hasMore);
    } catch (error) {
      if (requestId === memberRecordsRequestRef.current) {
        setMemberRecordsError(error instanceof Error ? error.message : "流水加载失败");
      }
    } finally {
      if (requestId === memberRecordsRequestRef.current) {
        memberRecordsLoadingRef.current = false;
        setMemberRecordsLoading(false);
      }
    }
  }, [groupId, selectedMemberId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedMemberId) {
        void loadMemberRecords(true);
        return;
      }
      memberRecordsRequestRef.current += 1;
      memberRecordsLoadingRef.current = false;
      memberRecordsCursorRef.current = null;
      setMemberRecords([]);
      setMemberRecordsHasMore(false);
      setMemberRecordsLoading(false);
      setMemberRecordsError(null);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      memberRecordsRequestRef.current += 1;
    };
  }, [loadMemberRecords, selectedMemberId]);



  const currentUserMember = members.find(m => m.userId === user?.uid);
  const creatorId = group?.creatorId || group?.createdBy;
  const isCreator = creatorId === user?.uid;
  const isSubAdmin = currentUserMember?.role === "SUB_ADMIN" || currentUserMember?.role === "ADMIN" || currentUserMember?.role === "OWNER";
  const isAdmin = isCreator || isSubAdmin;
  const hasClaimed = !!currentUserMember;
  useEffect(() => {
    if (!user || !groupId) return;
    let cancelled = false;

    const fetchPendingClaims = async () => {
      const filters: ProxyWhereClause[] = isAdmin
        ? [["groupId", "==", groupId], ["status", "==", "PENDING"]]
        : [["groupId", "==", groupId], ["requesterId", "==", user.uid], ["status", "==", "PENDING"]];
      const claims = await queryProxy<ClaimRequest>("ClaimRequests", filters);
      if (!cancelled) {
        setPendingClaimMemberIds(new Set(
          claims.filter((claim) => claim.requesterId === user.uid).map((claim) => claim.memberId)
        ));
        setPendingReviewCount(isAdmin ? claims.length : 0);
      }
    };

    const stopRefreshing = startVisibleRefresh(fetchPendingClaims);
    return () => {
      cancelled = true;
      stopRefreshing();
    };
  }, [groupId, user, isAdmin]);

  const getRecordOperatorLabel = (record: LedgerRecord) => {
    if (record.operatorId === "SYSTEM") return "系统自动计息";
    if (record.operatorId === user?.uid) return user.displayName || user.email?.split("@")[0] || "我";
    return recordOperatorNames[record.operatorId] || "未知用户";
  };

  const remainingTotal = members.reduce((sum, m) => sum + Math.max(Number(m.balance) || 0, 0), 0);
  
  const cumulativeTotal = members.reduce(
    (sum, member) => sum + Number(member.totalAdded ?? member.balance ?? 0), 0);

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      if (sortOption === "name") return a.remarkName.localeCompare(b.remarkName, 'zh-Hans-CN-u-co-pinyin', { sensitivity: "base", numeric: true });
      if (sortOption === "balance") {
        const category = (balance: number) => balance > 0 ? 0 : balance === 0 ? 1 : 2;
        const categoryDiff = category(a.balance) - category(b.balance);
        if (categoryDiff !== 0) return categoryDiff;
        return b.balance - a.balance;
      }
      const timeA = getTimeValue(a.createdAt);
      const timeB = getTimeValue(b.createdAt);
      return timeA - timeB;
    });
  }, [members, sortOption]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newMemberName.trim() || actionLockRef.current) return;
    actionLockRef.current = true;
    setIsActionLoading(true);
    try {
      await proxyRequest({ action: "addMember", data: { groupId, remarkName: newMemberName.trim() } });
      setRefreshToken((value) => value + 1);
      setIsAddMemberModalOpen(false);
      setNewMemberName("");
    } catch { alert("添加成员失败"); } finally {
      actionLockRef.current = false;
      setIsActionLoading(false);
    }
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
    setRecordBalanceMode("DEBT");
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
      } else if (result?.status === "APPROVED") {
        setRefreshToken((value) => value + 1);
      }
    } catch (err: unknown) { alert(getErrorMessage(err, "认领失败")); }
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
      const imageBlob = await fetch(dataUrl).then((response) => response.blob());
      const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/[\/\s:]/g, '');
      const imageFile = new File(
        [imageBlob],
        `countbottle-${group?.name || 'group'}-${generatedAt}.png`,
        { type: "image/png" }
      );
      let supportsFileSharing = false;
      if (typeof navigator.share === "function" && typeof navigator.canShare === "function") {
        try {
          supportsFileSharing = navigator.canShare({ files: [imageFile] });
        } catch {
          supportsFileSharing = false;
        }
      }
      setPreviewImageFile(imageFile);
      setCanSharePreviewImage(supportsFileSharing);
      setPreviewImage(dataUrl);
    } catch (err: unknown) {
      console.error(err);
      alert("生成图片失败: " + getErrorMessage(err, "未知错误"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSharePreviewImage = async () => {
    if (!previewImageFile || !canSharePreviewImage || isSharingPreviewImage) return;
    setIsSharingPreviewImage(true);
    try {
      const shareData: ShareData = { files: [previewImageFile] };
      if (typeof navigator.canShare !== "function" || !navigator.canShare(shareData)) {
        setCanSharePreviewImage(false);
        alert("当前浏览器不支持直接分享图片，请下载长图后分享。");
        return;
      }
      await navigator.share(shareData);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Failed to share image:", error);
        alert("调用系统分享失败，请使用下载长图。");
      }
    } finally {
      setIsSharingPreviewImage(false);
    }
  };

  const closePreviewImage = () => {
    setPreviewImage(null);
    setPreviewImageFile(null);
    setCanSharePreviewImage(false);
    setIsSharingPreviewImage(false);
  };

  const handleQuickAdd = async (memberId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || quickAddLocksRef.current.has(memberId)) return;

    quickAddLocksRef.current.add(memberId);
    setPendingQuickAddMemberIds(prev => new Set(prev).add(memberId));

    try {
      await proxyRequest({
        action: "quickAddRecord",
        operationId: createOperationId(),
        data: { groupId, memberId }
      });
      const floatId = ++floaterIdRef.current;
      setFloaters(prev => [...prev, { id: floatId, memberId }]);
      setTimeout(() => {
        setFloaters(prev => prev.filter(f => f.id !== floatId));
      }, 1000);
      setRefreshToken((value) => value + 1);
      void loadWeeklyRankings();
    } catch { alert("操作失败"); }
    finally {
      quickAddLocksRef.current.delete(memberId);
      setPendingQuickAddMemberIds(prev => {
        const next = new Set(prev);
        next.delete(memberId);
        return next;
      });
    }
  };

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember || !user || actionLockRef.current) return;
    const amount = parseInt(recordAmount, 10);
    if (isNaN(amount) || amount < 0) { alert("请输入有效的非负整数"); return; }

    actionLockRef.current = true;
    setIsActionLoading(true);
    
    try {
      await proxyRequest({
        action: "submitRecord",
        operationId: createOperationId(),
        data: {
          groupId,
          memberId: selectedMember.id,
          recordActionType,
          amount,
          ...(recordActionType === "SET" ? { balanceMode: recordBalanceMode } : {}),
          note: recordNote.trim()
        }
      });
      setRefreshToken((value) => value + 1);
      setRecordAmount("");
      setRecordNote("");
      setSelectedMemberId(null);
      if (recordActionType === "ADD" || recordActionType === "DEDUCT") {
        void loadWeeklyRankings();
      }
    } catch (err: unknown) { alert(getErrorMessage(err, "操作失败")); }
    finally {
      actionLockRef.current = false;
      setIsActionLoading(false);
    }
  };

  const handleEditRemarkName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !selectedMember || !editRemarkName.trim() || actionLockRef.current) return;
    actionLockRef.current = true;
    setIsActionLoading(true);
    try {
      const nextName = editRemarkName.trim();
      await proxyRequest({ action: "updateMemberName", data: { groupId, memberId: selectedMember.id, remarkName: nextName } });
      setMembers(prev => prev.map(member => member.id === selectedMember.id ? { ...member, remarkName: nextName } : member));
      setEditRemarkName(nextName);
      alert("成员昵称已保存");
    } catch (err: unknown) { alert(getErrorMessage(err, "修改失败")); }
    finally {
      actionLockRef.current = false;
      setIsActionLoading(false);
    }
  };

  const handleUnbind = async () => {
    if (!isCreator || !selectedMember || !selectedMember.userId) return;
    if (!confirm("确认要强制解绑该成员吗？解绑后卡片将变为空白卡片供重新认领，但流水会保留。")) return;
    try {
      await proxyRequest({ action: "unbindMember", data: { groupId, memberId: selectedMember.id } });
      setRefreshToken((value) => value + 1);
    }
    catch { alert("解绑失败"); }
  };

  const handleDeleteMember = async () => {
    if (!isCreator || !selectedMember) return;
    if (!confirm("⚠️ 危险操作：确认要删除该成员吗？与其相关的流水可能也会丢失或成为孤儿数据。")) return;
    try {
      await proxyRequest({ action: "deleteMember", data: { groupId, memberId: selectedMember.id } });
      setSelectedMemberId(null);
      setRefreshToken((value) => value + 1);
    } catch { alert("删除失败"); }
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
              <Link href={`/group/settings?id=${groupId}`} className="relative inline-flex items-center gap-2 rounded-full px-2 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors" aria-label={pendingReviewCount > 0 ? `有 ${pendingReviewCount} 个认领申请待处理` : "Settings"}>
                {pendingReviewCount > 0 && (
                  <span className="hidden sm:inline-flex rounded-full bg-red-50 dark:bg-red-900/20 px-2 py-0.5 text-xs font-bold text-red-600 dark:text-red-300">
                    待处理 {pendingReviewCount}
                  </span>
                )}
                <span className="relative">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  {pendingReviewCount > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-gray-900" />}
                </span>
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
                复制邀请链接
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

            {!!weeklyRankings && (weeklyRankings.add.length > 0 || weeklyRankings.deduct.length > 0) && (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {weeklyRankings.add[0] && (
                  <button
                    type="button"
                    onClick={() => setActiveRankingType("add")}
                    className="group flex min-w-0 items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4 text-left transition-all hover:border-emerald-300 hover:bg-emerald-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-white/10 dark:bg-white/5 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/20"
                    aria-label={`查看近 7 天新增排行榜，第一名 ${weeklyRankings.add[0].name}`}
                  >
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/70">
                        <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                        近 7 天新增最多
                      </div>
                      <div className="truncate text-base font-black text-gray-900 dark:text-white">{weeklyRankings.add[0].name}</div>
                    </div>
                    <div className="ml-3 shrink-0 text-right">
                      <div className="text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">{weeklyRankings.add[0].amount}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{group.unit} · 查看前三</div>
                    </div>
                  </button>
                )}
                {weeklyRankings.deduct[0] && (
                  <button
                    type="button"
                    onClick={() => setActiveRankingType("deduct")}
                    className="group flex min-w-0 items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4 text-left transition-all hover:border-orange-300 hover:bg-orange-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 dark:border-white/10 dark:bg-white/5 dark:hover:border-orange-700 dark:hover:bg-orange-950/20"
                    aria-label={`查看近 7 天核销排行榜，第一名 ${weeklyRankings.deduct[0].name}`}
                  >
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/70">
                        <ArrowDownRight className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />
                        近 7 天核销最多
                      </div>
                      <div className="truncate text-base font-black text-gray-900 dark:text-white">{weeklyRankings.deduct[0].name}</div>
                    </div>
                    <div className="ml-3 shrink-0 text-right">
                      <div className="text-2xl font-black tabular-nums text-orange-600 dark:text-orange-400">{weeklyRankings.deduct[0].amount}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{group.unit} · 查看前三</div>
                    </div>
                  </button>
                )}
              </div>
            )}

            {weeklyRankingError && !weeklyRankingLoading && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/20 dark:text-red-300">
                <span>近 7 天排行暂时加载失败</span>
                <button type="button" onClick={() => void loadWeeklyRankings()} className="inline-flex items-center gap-1 font-bold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />重试
                </button>
              </div>
            )}
            
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
                    : group.interestConfig.type === 'fixed'
                      ? `固定 +${group.interestConfig.fixedAmount || 0} / ${
                        { daily: '每日', weekly: '每周', monthly: '每月', yearly: '每年' }[group.interestConfig.frequency] || ''
                      }`
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
              const balanceView = getBalanceView(member.balance);
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
                        {member.userId === creatorId && <span className="px-1.5 py-0.5 text-[10px] font-black bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 rounded-md shrink-0">群主</span>}
                        {member.userId !== creatorId && ["OWNER", "ADMIN", "SUB_ADMIN"].includes(member.role) && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded-md shrink-0">子管理员</span>}
                        {isUnclaimed && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 rounded-md shrink-0">未认领</span>}
                      </h3>
                      {member.displayName && member.displayName !== member.remarkName && <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 truncate">{member.displayName}</p>}
                    </div>
                  </div>

                  {/* Right: Balance and Actions */}
                  <div className="flex items-center justify-end gap-3 sm:gap-6 shrink-0">
                    <div className="text-right flex flex-col justify-center">
                      <div className="hidden sm:block text-xs text-gray-500 dark:text-gray-400 mb-0.5">{balanceView.hasCredit ? "当前无欠款" : "当前欠款"}</div>
                      <div className="flex items-baseline gap-0.5 sm:gap-1">
                        <span className="text-xl sm:text-3xl font-black text-gray-900 dark:text-white leading-none"><AnimatedNumber value={balanceView.debt} /></span>
                        <span className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400">{group.unit}</span>
                      </div>
                      {balanceView.hasCredit && <div className="mt-1 text-[10px] sm:text-xs font-bold text-emerald-600 dark:text-emerald-400">抵扣额度 <span className="tabular-nums">{balanceView.credit}</span> {group.unit}</div>}
                    </div>
                    
                    <div className="w-12 sm:w-16 flex justify-end shrink-0 relative">
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={(e) => handleQuickAdd(member.id, e)}
                          disabled={pendingQuickAddMemberIds.has(member.id)}
                          aria-label={pendingQuickAddMemberIds.has(member.id) ? `正在为${member.remarkName}增加 1` : `为${member.remarkName}增加 1`}
                          aria-busy={pendingQuickAddMemberIds.has(member.id)}
                          className="relative z-10 flex h-8 w-10 items-center justify-center rounded-lg bg-primary text-base font-black text-white transition-all hover:-translate-y-1 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 active:scale-95 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0 sm:h-12 sm:w-12 sm:rounded-xl sm:text-lg"
                        >
                          {pendingQuickAddMemberIds.has(member.id)
                            ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none sm:h-5 sm:w-5" aria-hidden="true" />
                            : "+1"}
                        </button>
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

      <Modal isOpen={isAddMemberModalOpen} onClose={() => !isActionLoading && setIsAddMemberModalOpen(false)} title="添加新成员 (空白卡片)">
        <form onSubmit={handleAddMember} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">成员备注名</label>
            <input type="text" required maxLength={20} value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary outline-none transition-all" placeholder="例如：张三" />
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsAddMemberModalOpen(false)} disabled={isActionLoading} className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">取消</button>
            <button type="submit" disabled={isActionLoading || !newMemberName.trim()} aria-busy={isActionLoading} className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:cursor-wait disabled:opacity-60">{isActionLoading ? "添加中..." : "确认添加"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!selectedMemberId} onClose={() => setSelectedMemberId(null)} title="成员详情与账目记录" maxWidth="xl">
        {selectedMember && (
          <div className="space-y-6">
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-2xl flex justify-between items-center">
              <div>
                <h4 className="text-lg font-bold text-gray-900 dark:text-white">{selectedMember.remarkName}</h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">当前欠款: <span className="font-black text-gray-900 dark:text-white text-lg"><AnimatedNumber value={getBalanceView(selectedMember.balance).debt} /></span> {group.unit}</p>
                {getBalanceView(selectedMember.balance).hasCredit && <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">抵扣额度: {getBalanceView(selectedMember.balance).credit} {group.unit}</p>}
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
                {recordActionType === "SET" && (
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="调平目标状态">
                    <button type="button" onClick={() => setRecordBalanceMode("DEBT")} className={`py-2 rounded-lg text-sm font-bold transition-colors ${recordBalanceMode === "DEBT" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>设为欠款</button>
                    <button type="button" onClick={() => setRecordBalanceMode("CREDIT")} disabled={group.creditBalanceStatus !== "enabled"} className={`py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${recordBalanceMode === "CREDIT" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"}`}>设为抵扣额度</button>
                  </div>
                )}
                {recordActionType === "SET" && group.creditBalanceStatus !== "enabled" && <p className="text-xs text-gray-500">群主开启超额核销后，才可调平为抵扣额度。</p>}
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3">
                  <input type="number" required min={0} value={recordAmount} onChange={(e) => setRecordAmount(e.target.value)} placeholder="输入数量" className="w-full min-w-0 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 outline-none focus:ring-2 focus:ring-primary text-base" />
                </div>
                <textarea value={recordNote} onChange={(e) => setRecordNote(e.target.value)} maxLength={200} rows={2} placeholder="备注（可选）" className="w-full min-w-0 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 outline-none focus:ring-2 focus:ring-primary text-base resize-none" />
                <button type="submit" disabled={isActionLoading || !recordAmount} aria-busy={isActionLoading} className="w-full min-h-11 px-6 rounded-xl font-bold text-white bg-primary disabled:cursor-wait disabled:opacity-60">{isActionLoading ? "处理中..." : "提交"}</button>
              </form>
            )}

            <div>
              <h5 className="font-bold text-gray-900 dark:text-white mb-3">流水记录</h5>
              <div className="max-h-60 overflow-y-auto space-y-3 pr-2">
                {!memberRecordsLoading && memberRecords.length === 0 ? <p className="text-sm text-gray-500 text-center py-4">暂无流水记录</p> :
                  memberRecords.map(record => (
                    <div key={record.id} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-gray-100 dark:border-gray-800">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {record.type === "ADD" && "增加"}
                          {record.type === "DEDUCT" && "核销"}
                          {record.type === "SET" && (record.balanceMode === "CREDIT" || Number(record.afterBalance) < 0 ? "强制调平为抵扣额度" : "强制调平为欠款")}
                          {record.type === "INTEREST" && "自动计息"}
                        </span>
                        <span className="text-xs text-gray-500 mt-1">{record.createdAt ? new Date(getTimeValue(record.createdAt)).toLocaleString() : "刚刚"}</span>
                        <span className="text-xs text-gray-500 mt-1">操作人：{getRecordOperatorLabel(record)}</span>
                        {record.note && <span className="text-xs text-gray-500 mt-1 break-words">备注：{record.note}</span>}
                      </div>
                      <span className={`font-black ${record.type === 'DEDUCT' ? 'text-orange-500' : 'text-primary'}`}>
                        {record.type === 'DEDUCT' ? '-' : record.type === 'ADD' || record.type === 'INTEREST' ? '+' : ''}{record.amount}
                      </span>
                    </div>
                  ))}
                {(memberRecords.length > 0 || memberRecordsLoading || memberRecordsError) && (
                  <InfiniteScrollTrigger
                  hasMore={memberRecordsHasMore}
                  loading={memberRecordsLoading}
                  error={memberRecordsError}
                  onLoadMore={loadMemberRecords}
                  endLabel="已加载全部流水"
                  />
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
                    <button type="submit" disabled={isActionLoading || !editRemarkName} aria-busy={isActionLoading} className="w-full sm:w-auto min-h-10 px-4 text-sm font-bold bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg whitespace-nowrap disabled:cursor-wait disabled:opacity-60">{isActionLoading ? "保存中..." : "保存"}</button>
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
      <Modal
        isOpen={activeRankingType !== null}
        onClose={() => setActiveRankingType(null)}
        title={activeRankingType === "deduct" ? "近 7 天核销排行榜" : "近 7 天新增排行榜"}
        maxWidth="lg"
      >
        {activeRankingType && weeklyRankings && (
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              含今天在内的 7 个自然日。仅统计记账与实际消除欠款的核销数量；调平及形成抵扣额度的部分不计入排行。
            </p>
            <RankingPodium entries={weeklyRankings[activeRankingType]} unit={group.unit} />
          </div>
        )}
      </Modal>
      <Modal isOpen={!!previewImage} onClose={closePreviewImage} title="排行榜长图">
        <div className="flex flex-col items-center gap-4">
          <div className="space-y-1 text-center">
            <p className="text-sm text-gray-500">
              {canSharePreviewImage ? "可直接调用手机系统分享，也可以下载图片" : "长按图片（手机）、右键（电脑）或点击下方按钮下载"}
            </p>
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">分享到微信建议长按图片进行操作</p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto w-full flex justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black p-2">
            {previewImage && <Image src={previewImage} alt="群组长图" width={800} height={1200} unoptimized className="max-w-full h-auto rounded-lg shadow-sm" style={{ objectFit: 'contain' }} />}
          </div>
          <div className="grid w-full grid-cols-2 gap-3">
            {canSharePreviewImage && (
              <button
                type="button"
                onClick={() => void handleSharePreviewImage()}
                disabled={isSharingPreviewImage}
                className="order-first col-span-2 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 font-bold text-white shadow-lg shadow-primary/30 transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
              >
                <Share2 className="h-5 w-5" aria-hidden="true" />
                {isSharingPreviewImage ? "正在打开分享..." : "分享长图图片"}
              </button>
            )}
            <button onClick={closePreviewImage} className="py-3 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-white font-bold hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors">
              关闭
            </button>
            <a href={previewImage || "#"} download={previewImageFile?.name || "countbottle-group.png"} className={`flex items-center justify-center gap-2 rounded-xl py-3 font-bold transition-colors ${canSharePreviewImage ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100" : "bg-primary text-white shadow-lg shadow-primary/30 hover:bg-primary/90"}`}>
              <Download className="h-5 w-5" aria-hidden="true" />
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
            {sortedMembers.filter((member) => Number(member.balance) !== 0).map((member, index) => (
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
                <div className="text-right" title={formatBalanceState(member.balance, group?.unit)}>
                  <div><span className="text-xl font-black text-gray-900 dark:text-white">{getBalanceView(member.balance).debt}</span></div>
                  {getBalanceView(member.balance).hasCredit && <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">抵扣额度 {getBalanceView(member.balance).credit}</div>}
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
