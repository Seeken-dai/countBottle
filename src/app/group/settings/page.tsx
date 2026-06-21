"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDocProxy, proxyRequest, queryPageProxy, queryProxy, type ProxyWhereClause } from "@/lib/useFirestore";
import { InfiniteScrollTrigger } from "@/components/infinite-scroll-trigger";
import { ThemeToggle } from "@/components/theme-toggle";
import { Suspense } from "react";
import { addInterestPeriods, createInterestScheduleAnchor, type InterestScheduleAnchor } from "@/lib/interest-schedule";

interface InterestConfig {
  rate: number | string;
  fixedAmount?: number | string;
  type: "none" | "simple" | "compound" | "fixed";
  frequency: "none" | "daily" | "weekly" | "monthly" | "yearly";
  nextInterestAt?: unknown;
  lastCalculatedAt?: any;
  scheduleAnchor?: InterestScheduleAnchor | null;
}

interface MemberData {
  id: string;
  groupId: string;
  userId: string | null;
  role: string;
  remarkName: string;
  balance: number;
}

interface ClaimRequest {
  id: string;
  memberId: string;
  memberName?: string;
  requesterEmail?: string;
  requesterName?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt?: any;
}

interface AuditLog {
  id: string;
  type: string;
  summary: string;
  operatorId: string;
  targetType?: string | null;
  targetId?: string | null;
  actorName?: string | null;
  targetName?: string | null;
  amount?: number | null;
  beforeBalance?: number | null;
  afterBalance?: number | null;
  note?: string | null;
  displayTitle?: string | null;
  displayDetail?: string | null;
  metadata?: {
    amount?: number;
    note?: string;
    type?: string;
    frequency?: string;
    rate?: number;
    [key: string]: unknown;
  };
  createdAt?: any;
}

type AuditFilter = "ALL" | "BALANCE" | "MEMBER" | "CLAIM" | "SETTINGS" | "INTEREST";
type AuditCategory = Exclude<AuditFilter, "ALL">;

const auditFilters: { value: AuditFilter; label: string }[] = [
  { value: "ALL", label: "全部" },
  { value: "BALANCE", label: "余额变化" },
  { value: "MEMBER", label: "成员变更" },
  { value: "CLAIM", label: "认领审核" },
  { value: "SETTINGS", label: "群组设置" },
  { value: "INTEREST", label: "计息相关" }
];

const auditTypesByFilter: Record<Exclude<AuditFilter, "ALL">, string[]> = {
  BALANCE: ["BALANCE_ADD", "BALANCE_DEDUCT", "BALANCE_SET"],
  MEMBER: [
    "CREATOR_TRANSFER", "MEMBER_ADDED", "MEMBER_ROLE_UPDATED",
    "MEMBER_NAME_UPDATED", "MEMBER_UNBOUND", "MEMBER_DELETED", "MEMBER_CLAIMED"
  ],
  CLAIM: [
    "CLAIM_APPROVAL_SETTING_UPDATED", "CLAIM_REQUESTED", "CLAIM_APPROVED", "CLAIM_REJECTED"
  ],
  SETTINGS: ["GROUP_SETTINGS_UPDATED"],
  INTEREST: ["INTEREST_SETTINGS_UPDATED", "INTEREST_APPLIED"]
};

function getAuditWhere(groupId: string, filter: AuditFilter) {
  const where: ProxyWhereClause[] = [["groupId", "==", groupId]];
  if (filter !== "ALL") where.push(["type", "in", auditTypesByFilter[filter]]);
  return where;
}

function getTimeValue(value: any) {
  if (!value) return 0;
  if (typeof value === "string") return new Date(value).getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value._seconds === "number") return value._seconds * 1000;
  return 0;
}

function formatDateTimeLocal(value: any) {
  const timeValue = getTimeValue(value);
  if (!timeValue) return "";
  const date = new Date(timeValue);
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateOnly(value: Date) {
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function toIsoFromDateTimeLocal(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function getCurrentMinuteValue() {
  const now = new Date();
  now.setSeconds(0, 0);
  return formatDateTimeLocal(now.toISOString());
}

function formatAuditTime(value: any) {
  const timeValue = getTimeValue(value);
  if (!timeValue) return "刚刚";
  const date = new Date(timeValue);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfLogDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const timeText = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (startOfLogDay === startOfToday) return `今天 ${timeText}`;
  if (startOfLogDay === startOfToday - 24 * 60 * 60 * 1000) return `昨天 ${timeText}`;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function getAuditCategory(type = ""): AuditCategory {
  if (type.startsWith("BALANCE")) return "BALANCE";
  if (type.startsWith("MEMBER") || type === "CREATOR_TRANSFER") return "MEMBER";
  if (type.startsWith("CLAIM")) return "CLAIM";
  if (type.startsWith("INTEREST")) return "INTEREST";
  return "SETTINGS";
}

function getAuditTag(log: AuditLog) {
  const tags: Record<string, string> = {
    BALANCE_ADD: "余额增加",
    BALANCE_DEDUCT: "余额核销",
    BALANCE_SET: "余额调平",
    MEMBER_ADDED: "新增成员",
    MEMBER_ROLE_UPDATED: "权限调整",
    MEMBER_NAME_UPDATED: "修改昵称",
    MEMBER_UNBOUND: "解绑账号",
    MEMBER_DELETED: "删除成员",
    MEMBER_CLAIMED: "成员认领",
    CLAIM_REQUESTED: "认领申请",
    CLAIM_APPROVED: "认领通过",
    CLAIM_REJECTED: "认领拒绝",
    CLAIM_APPROVAL_SETTING_UPDATED: "认领设置",
    GROUP_SETTINGS_UPDATED: "群组设置",
    INTEREST_SETTINGS_UPDATED: "计息设置",
    INTEREST_APPLIED: "自动计息",
    CREATOR_TRANSFER: "群主移交"
  };
  return tags[log.type] || "系统记录";
}

function getAuditTone(log: AuditLog) {
  const category = getAuditCategory(log.type);
  if (category === "BALANCE") return "bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-900/40";
  if (category === "MEMBER") return "bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-900/40";
  if (category === "CLAIM") return "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/40";
  if (category === "INTEREST") return "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/40";
  return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700";
}

function cleanLegacySummary(summary?: string) {
  const text = (summary || "").trim();
  if (!text) return "";
  return text
    .replace(/：\s*(ADD|DEDUCT|SET)\s*$/i, "")
    .replace(/\b(BALANCE|MEMBER|CLAIM|GROUP|INTEREST)_[A-Z_]+\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getAuditTitle(log: AuditLog) {
  if (log.displayTitle) return log.displayTitle;
  const targetName = log.targetName || "成员";
  const amount = typeof log.amount === "number" ? log.amount : log.metadata?.amount;
  if (log.type === "BALANCE_ADD") return amount ? `给${targetName}记了一笔 +${amount}` : cleanLegacySummary(log.summary) || "记录了一笔增加";
  if (log.type === "BALANCE_DEDUCT") return amount ? `为${targetName}核销了 ${amount}` : "核销了成员余额";
  if (log.type === "BALANCE_SET") return typeof log.afterBalance === "number" ? `将${targetName}余额调为 ${log.afterBalance}` : "调整了成员余额";
  if (log.type === "MEMBER_NAME_UPDATED") return cleanLegacySummary(log.summary) || "修改了成员昵称";
  if (log.type === "INTEREST_SETTINGS_UPDATED") return "更新了计息规则";
  if (log.type === "INTEREST_APPLIED") return cleanLegacySummary(log.summary) || "系统完成自动计息";
  return cleanLegacySummary(log.summary) || getAuditTag(log);
}

function getAuditNote(log: AuditLog) {
  const note = log.note || log.metadata?.note;
  return typeof note === "string" && note.trim() ? note.trim() : "";
}

function getAuditDetailRows(log: AuditLog) {
  const rows: { label: string; value: string }[] = [];
  if (log.actorName) rows.push({ label: "操作者", value: log.actorName });
  if (log.targetName) rows.push({ label: "对象", value: log.targetName });
  const amount = typeof log.amount === "number" ? log.amount : log.metadata?.amount;
  if (typeof amount === "number") rows.push({ label: "数量", value: String(amount) });
  if (typeof log.beforeBalance === "number" && typeof log.afterBalance === "number") {
    rows.push({ label: "余额变化", value: `${log.beforeBalance} → ${log.afterBalance}` });
  }
  if (log.displayDetail) rows.push({ label: "说明", value: log.displayDetail });
  return rows;
}

function GroupSettingsContent() {
  const searchParams = useSearchParams();
  const groupId = searchParams.get("id") as string;
  const { user } = useAuth();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [groupName, setGroupName] = useState("");
  const [groupUnit, setGroupUnit] = useState("");
  const [announcementText, setAnnouncementText] = useState("");
  const [requireClaimApproval, setRequireClaimApproval] = useState(false);
  const [interestConfig, setInterestConfig] = useState<InterestConfig>({
    rate: 0,
    fixedAmount: 0,
    type: "none",
    frequency: "none"
  });
  const [interestStartAt, setInterestStartAt] = useState("");

  const [members, setMembers] = useState<MemberData[]>([]);
  const [claimRequests, setClaimRequests] = useState<ClaimRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("ALL");
  const [expandedAuditLogIds, setExpandedAuditLogIds] = useState<Set<string>>(new Set());
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const auditCursorRef = useRef<string | null>(null);
  const auditLoadingRef = useRef(false);
  const auditRequestRef = useRef(0);

  const loadAuditLogs = useCallback(async (reset = false) => {
    if (!isAdmin || (auditLoadingRef.current && !reset)) return;
    if (reset) {
      auditRequestRef.current += 1;
      auditLoadingRef.current = false;
      auditCursorRef.current = null;
      setAuditLogs([]);
      setExpandedAuditLogIds(new Set());
      setAuditHasMore(true);
    }

    const requestId = auditRequestRef.current;
    auditLoadingRef.current = true;
    setAuditLoading(true);
    setAuditError(null);
    try {
      const page = await queryPageProxy<AuditLog>(
        "AuditLogs",
        getAuditWhere(groupId, auditFilter),
        ["createdAt", "desc"],
        50,
        auditCursorRef.current
      );
      if (requestId !== auditRequestRef.current) return;

      setAuditLogs((previous) => reset
        ? page.docs
        : [...previous, ...page.docs.filter((log) => !previous.some((item) => item.id === log.id))]);
      auditCursorRef.current = page.nextCursor;
      setAuditHasMore(page.hasMore);
    } catch (error) {
      if (requestId === auditRequestRef.current) {
        setAuditError(error instanceof Error ? error.message : "日志加载失败");
      }
    } finally {
      if (requestId === auditRequestRef.current) {
        auditLoadingRef.current = false;
        setAuditLoading(false);
      }
    }
  }, [auditFilter, groupId, isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isAdmin) {
        void loadAuditLogs(true);
        return;
      }
      auditRequestRef.current += 1;
      auditLoadingRef.current = false;
      auditCursorRef.current = null;
      setAuditLogs([]);
      setAuditHasMore(false);
      setAuditLoading(false);
      setAuditError(null);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      auditRequestRef.current += 1;
    };
  }, [isAdmin, loadAuditLogs]);

  useEffect(() => {
    const fetchAuthAndData = async () => {
      if (!user) return;
      
      const data = await getDocProxy("Groups", groupId);
      if (data) {
        const creatorId = data.creatorId || data.createdBy;
        const fetchedMembers = await queryProxy("Members", [["groupId", "==", groupId]]) as MemberData[];
        const currentMember = fetchedMembers.find(member => member.userId === user.uid);
        const canManage = creatorId === user.uid || currentMember?.role === "OWNER" || currentMember?.role === "ADMIN" || currentMember?.role === "SUB_ADMIN";
        if (!canManage) {
          alert("你没有权限访问设置页");
          router.push(`/group/detail?id=${groupId}`);
          return;
        }
        setIsAdmin(true);
        setIsCreator(creatorId === user.uid);
        setGroupName(data.name || "");
        setGroupUnit(data.unit || "瓶");
        setAnnouncementText(data.announcement || "");
        setRequireClaimApproval(!!data.requireClaimApproval);
        if (data.interestConfig) {
          setInterestConfig(data.interestConfig);
          setInterestStartAt(formatDateTimeLocal(data.interestConfig.nextInterestAt));
        }

        setMembers(fetchedMembers);
        const fetchedClaims = await queryProxy("ClaimRequests", [["groupId", "==", groupId], ["status", "==", "PENDING"]]) as ClaimRequest[];
        fetchedClaims.sort((a, b) => getTimeValue(b.createdAt) - getTimeValue(a.createdAt));
        setClaimRequests(fetchedClaims);
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
      await proxyRequest({ action: "updateGroupBasic", data: { groupId, name: groupName.trim(), unit: groupUnit.trim(), announcement: announcementText.trim() } });
      alert("基础设置已保存");
    } catch (err) { alert("保存失败"); }
    finally { setIsSaving(false); }
  };

  const handleSaveInterest = async (e: React.FormEvent) => {
    e.preventDefault();
    const isEnabled = interestConfig.type !== "none" && interestConfig.frequency !== "none";
    const nextInterestAt = isEnabled ? toIsoFromDateTimeLocal(interestStartAt) : null;
    const selectedInterestDate = nextInterestAt ? new Date(nextInterestAt) : null;
    const scheduleAnchor = isEnabled && selectedInterestDate
      ? interestConfig.scheduleAnchor || createInterestScheduleAnchor(new Date(interestStartAt))
      : null;
    const currentMinute = new Date();
    currentMinute.setSeconds(0, 0);
    if (isEnabled && (!nextInterestAt || new Date(nextInterestAt).getTime() < currentMinute.getTime())) {
      alert("下一次计息时间必须设置为当前或未来时间");
      return;
    }
    setIsSaving(true);
    try {
      await proxyRequest({ action: "updateGroupInterest", data: { groupId,
        interestConfig: {
          ...interestConfig,
          rate: Number(interestConfig.rate) || 0,
          fixedAmount: Number(interestConfig.fixedAmount) || 0,
          nextInterestAt,
          lastCalculatedAt: null,
          scheduleAnchor
        }
      }});
      setInterestConfig(prev => ({ ...prev, nextInterestAt, lastCalculatedAt: null, scheduleAnchor }));
      alert("计息设置已保存");
    } catch (err: unknown) { alert(err instanceof Error ? err.message : "保存失败"); }
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
      await proxyRequest({ action: "batchDeleteGroup", docId: groupId });
      router.push("/dashboard");
    } catch (err) {
      alert("删除失败");
      setIsSaving(false);
    }
  };

  const handleSaveClaimApproval = async () => {
    setIsSaving(true);
    try {
      await proxyRequest({ action: "updateGroupClaimApproval", data: { groupId, requireClaimApproval } });
      alert("认领审核设置已保存");
    } catch (err) {
      alert("保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReviewClaim = async (request: ClaimRequest, decision: "APPROVED" | "REJECTED") => {
    setIsSaving(true);
    try {
      await proxyRequest({ action: "reviewClaim", data: { requestId: request.id, decision } });
      setClaimRequests(prev => prev.filter(item => item.id !== request.id));
      const fetchedMembers = await queryProxy("Members", [["groupId", "==", groupId]]) as MemberData[];
      setMembers(fetchedMembers);
      await loadAuditLogs(true);
    } catch (err: any) {
      alert(err.message || "审核失败");
    } finally {
      setIsSaving(false);
    }
  };


  const toggleAuditDetail = (logId: string) => {
    setExpandedAuditLogIds(prev => {
      const next = new Set(prev);
      if (next.has(logId)) next.delete(logId);
      else next.add(logId);
      return next;
    });
  };

  const renderPreview = () => {
    const isFixedInterest = interestConfig.type === "fixed";
    const hasValidAmount = isFixedInterest ? Number(interestConfig.fixedAmount) > 0 : Number(interestConfig.rate) > 0;
    if (interestConfig.type === "none" || interestConfig.frequency === "none" || !hasValidAmount) {
      return <p className="text-sm text-gray-500">当前未开启计息，或参数未配置完整。</p>;
    }

    const balances = [10];
    const rate = (Number(interestConfig.rate) || 0) / 100;
    const fixedAmount = Number(interestConfig.fixedAmount) || 0;
    const baseTime = getTimeValue(interestStartAt || interestConfig.nextInterestAt);
    if (!baseTime) {
      return <p className="text-sm text-gray-500">请先设置下一次计息时间。</p>;
    }
    
    for (let i = 1; i <= 6; i++) {
      const prev = balances[i-1];
      if (interestConfig.type === "fixed") {
        balances.push(prev + fixedAmount);
      } else if (interestConfig.type === "simple") {
        // Simple interest: base is always 10
        balances.push(prev + 10 * rate);
      } else {
        // Compound interest
        balances.push(prev + prev * rate);
      }
    }

    const previewItems = [
      { label: "初始", value: "10.00", date: "-", isInitial: true },
      ...balances.slice(1).map((balance, index) => ({
        label: `第${index + 1}期`,
        date: formatDateOnly(addInterestPeriods(
          new Date(baseTime),
          interestConfig.frequency as Exclude<InterestConfig["frequency"], "none">,
          index,
          interestConfig.scheduleAnchor || createInterestScheduleAnchor(new Date(baseTime))
        )),
        value: balance.toFixed(2),
        isInitial: false
      }))
    ];

    return (
      <div className="mt-4 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
        <h5 className="text-sm font-bold text-gray-900 dark:text-white mb-3">预览 (基于当前设置)</h5>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {previewItems.map(item => (
            <div key={item.label} className="rounded-lg bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-3 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="font-bold text-gray-600 dark:text-gray-300 whitespace-nowrap">{item.label}</div>
                <div className="font-mono text-[11px] text-gray-400 whitespace-nowrap">{item.date}</div>
              </div>
              <div className={`font-mono font-bold mt-2 text-base ${item.isInitial ? "text-gray-900 dark:text-white" : "text-primary"}`}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3 text-center leading-relaxed">注：推演结果仅供参考，实际计算将根据设定频率在用户访问时结算。</p>
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
                      {m.remarkName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white">{m.remarkName}</h4>
                      <p className="text-xs text-gray-500 mt-0.5">{m.role === "SUB_ADMIN" ? "子管理员" : "普通成员"}</p>
                    </div>
                  </div>
                  <button 
                    onClick={async () => {
                      const newRole = m.role === "SUB_ADMIN" ? "MEMBER" : "SUB_ADMIN";
                      await proxyRequest({ action: "updateMemberRole", data: { groupId, memberId: m.id, role: newRole } });
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

        {/* Claim Approval */}
        <section className="bg-white dark:bg-gray-900 rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white mb-6 flex items-center">
            <span className="w-8 h-8 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 flex items-center justify-center mr-3">审</span>
            成员认领审核
          </h2>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">认领需管理员审核</h3>
              <p className="text-xs text-gray-500 mt-1">开启后，成员点击认领会先进入待审核列表。</p>
            </div>
            <label className="inline-flex items-center gap-3 text-sm font-bold text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={requireClaimApproval} onChange={e => setRequireClaimApproval(e.target.checked)} className="h-5 w-5 accent-primary" />
              {requireClaimApproval ? "已开启" : "已关闭"}
            </label>
          </div>
          <button type="button" onClick={handleSaveClaimApproval} disabled={isSaving} className="mt-4 w-full py-3 rounded-xl font-bold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50">
            保存认领设置
          </button>

          <div className="mt-6">
            <h3 className="font-bold text-gray-900 dark:text-white mb-3">待审核申请</h3>
            <div className="space-y-3">
              {claimRequests.length === 0 ? (
                <div className="text-center py-6 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-gray-400 text-sm">暂无待审核申请</div>
              ) : claimRequests.map(request => (
                <div key={request.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-800">
                  <div>
                    <h4 className="font-bold text-gray-900 dark:text-white">{request.memberName || request.memberId}</h4>
                    <p className="text-xs text-gray-500 mt-1">{request.requesterName || request.requesterEmail || "未知用户"} 发起认领</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleReviewClaim(request, "REJECTED")} disabled={isSaving} className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-bold bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50">拒绝</button>
                    <button type="button" onClick={() => handleReviewClaim(request, "APPROVED")} disabled={isSaving} className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-50">通过</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Audit Logs */}
        <section className="bg-white dark:bg-gray-900 rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <h2 className="text-xl font-extrabold text-gray-900 dark:text-white flex items-center">
              <span className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex items-center justify-center mr-3">志</span>
              群组操作日志
            </h2>
            <select value={auditFilter} onChange={e => setAuditFilter(e.target.value as AuditFilter)} className="px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 text-sm outline-none focus:ring-2 focus:ring-primary">
              {auditFilters.map(filter => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {!auditLoading && auditLogs.length === 0 ? (
              <div className="text-center py-6 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-gray-400 text-sm">暂无匹配日志</div>
            ) : auditLogs.map(log => {
              const detailRows = getAuditDetailRows(log);
              const note = getAuditNote(log);
              const isExpanded = expandedAuditLogIds.has(log.id);
              const amount = typeof log.amount === "number" ? log.amount : log.metadata?.amount;
              const showAmount = getAuditCategory(log.type) === "BALANCE" && typeof amount === "number";
              return (
                <div key={log.id} className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-bold text-gray-900 dark:text-white leading-snug break-words">{getAuditTitle(log)}</h4>
                      <p className="text-xs text-gray-500 mt-1">{formatAuditTime(log.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className={`text-[11px] px-2 py-1 rounded-full border font-medium ${getAuditTone(log)}`}>{getAuditTag(log)}</span>
                      {showAmount && (
                        <span className={`text-sm font-black ${log.type === "BALANCE_DEDUCT" ? "text-orange-500" : "text-primary"}`}>
                          {log.type === "BALANCE_DEDUCT" ? "-" : log.type === "BALANCE_SET" ? "=" : "+"}{amount}
                        </span>
                      )}
                    </div>
                  </div>

                  {note && (
                    <p className="mt-3 rounded-xl bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-800 break-words">
                      备注：{note}
                    </p>
                  )}

                  {detailRows.length > 0 && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => toggleAuditDetail(log.id)}
                        className="text-xs font-bold text-primary hover:text-primary/80 transition-colors"
                      >
                        {isExpanded ? "收起详情" : "查看详情"}
                      </button>
                      {isExpanded && (
                        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {detailRows.map(row => (
                            <div key={`${log.id}-${row.label}`} className="rounded-lg bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-3 py-2">
                              <dt className="text-gray-400 mb-1">{row.label}</dt>
                              <dd className="text-gray-700 dark:text-gray-300 break-words">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {(auditLogs.length > 0 || auditLoading || auditError) && (
              <InfiniteScrollTrigger
              hasMore={auditHasMore}
              loading={auditLoading}
              error={auditError}
              onLoadMore={loadAuditLogs}
              endLabel="已加载全部日志"
              />
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
                  <option value="fixed">固定数量 (每期固定增加)</option>
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
            
            {interestConfig.type === "fixed" ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">每期固定增加数量</label>
                <input type="number" min="0" step="0.01" value={interestConfig.fixedAmount ?? ""} onChange={e => setInterestConfig({...interestConfig, fixedAmount: e.target.value === '' ? '' : e.target.value})} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-primary outline-none transition-all disabled:opacity-50" />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">每期利率 (%)</label>
                <input type="number" min="0" step="0.1" value={interestConfig.rate} onChange={e => setInterestConfig({...interestConfig, rate: e.target.value === '' ? '' : e.target.value})} disabled={interestConfig.type === "none"} className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-primary outline-none transition-all disabled:opacity-50" />
              </div>
            )}

            {isCreator && (
              <div className="rounded-2xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/60 dark:bg-amber-900/10 p-4">
                <label className="block text-sm font-bold text-gray-900 dark:text-white mb-1">下一次计息时间</label>
                <input
                  type="datetime-local"
                  value={interestStartAt}
                  onChange={e => {
                    setInterestStartAt(e.target.value);
                    const selectedDate = new Date(e.target.value);
                    if (!Number.isNaN(selectedDate.getTime())) {
                      setInterestConfig(prev => ({ ...prev, scheduleAnchor: createInterestScheduleAnchor(selectedDate) }));
                    }
                  }}
                  min={getCurrentMinuteValue()}
                  required={interestConfig.type !== "none" && interestConfig.frequency !== "none"}
                  disabled={interestConfig.type === "none" || interestConfig.frequency === "none"}
                  className="w-full px-4 py-3 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-white dark:bg-gray-950 focus:ring-2 focus:ring-primary outline-none transition-all disabled:opacity-50"
                />
                <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-2 leading-relaxed">
                  到达该时间后，系统会在下次访问群组时结息；若错过多个周期，将一次性补算。调整不会影响历史利息流水。
                </p>
              </div>
            )}

            {renderPreview()}

            <button type="submit" disabled={isSaving} className="w-full py-3 rounded-xl font-bold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50">
              保存计息规则
            </button>
          </form>
        </section>

        {/* Danger Zone */}
        {isCreator && <section className="bg-red-50/50 dark:bg-red-900/10 rounded-3xl p-6 md:p-8 border border-red-100 dark:border-red-900/30">
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
        </section>}
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
