import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/auth-server";
import { FieldValue, type Query } from "firebase-admin/firestore";
import { getDueInterestSchedule, normalizeInterestScheduleAnchor, type InterestFrequency } from "@/lib/interest-schedule";

export const runtime = "nodejs";

const MAX_QUERY_LIMIT = 500;

const ALLOWED_QUERY_FIELDS: Record<string, ReadonlySet<string>> = {
  Users: new Set(),
  Groups: new Set(),
  Members: new Set(["groupId", "userId"]),
  Records: new Set(["groupId", "memberId"]),
  ClaimRequests: new Set(["groupId", "requesterId", "status"]),
  AuditLogs: new Set(["groupId", "type"])
};
const ALLOWED_GET_COLLECTIONS = new Set(["Groups", "Users", "SuperAdmins"]);

type WhereClause = [string, "==", unknown];

function parseWhereClauses(value: unknown): WhereClause[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const clauses: WhereClause[] = [];
  for (const clause of value) {
    if (!Array.isArray(clause) || clause.length !== 3 || typeof clause[0] !== "string" || clause[1] !== "==") return null;
    clauses.push([clause[0], clause[1], clause[2]]);
  }
  return clauses;
}

function getEqualityValue(clauses: WhereClause[], field: string) {
  return clauses.find((clause) => clause[0] === field)?.[2];
}

function getSafeQueryLimit(value: unknown) {
  if (value === undefined) return MAX_QUERY_LIMIT;
  if (!Number.isInteger(value) || Number(value) < 1) return null;
  return Math.min(Number(value), MAX_QUERY_LIMIT);
}

function hasOnlyKeys(value: unknown, allowedKeys: ReadonlySet<string>) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => allowedKeys.has(key));
}

function serializeFirestore(value: any): any {
  if (!value) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeFirestore);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeFirestore(item)]));
  }
  return value;
}

function resolveSentinels(value: any): any {
  if (!value || typeof value !== "object") return value;
  if (value.__serverTimestamp) return FieldValue.serverTimestamp();
  if (typeof value.__increment === "number") return FieldValue.increment(value.__increment);
  if (Array.isArray(value)) return value.map(resolveSentinels);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveSentinels(item)]));
}

function parseFirestoreDate(value: unknown) {
  if (!value) return null;
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    date = value.toDate();
  } else if (typeof value === "string" || typeof value === "number") {
    date = new Date(value);
  } else {
    return null;
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

async function isSuperAdmin(uid: string) {
  const snap = await adminDb.collection("SuperAdmins").doc(uid).get();
  return snap.exists;
}

async function canManageGroup(groupId: string, uid: string) {
  if (!groupId || !uid) return false;
  if (await isSuperAdmin(uid)) return true;

  const groupSnap = await adminDb.collection("Groups").doc(groupId).get();
  const group = groupSnap.data();
  if (group?.creatorId === uid || group?.createdBy === uid) return true;

  const memberSnap = await adminDb
    .collection("Members")
    .where("groupId", "==", groupId)
    .where("userId", "==", uid)
    .limit(1)
    .get();
  const role = memberSnap.docs[0]?.data()?.role;
  return role === "OWNER" || role === "ADMIN" || role === "SUB_ADMIN";
}

function getUserDisplayName(user: { name?: string | null; email?: string | null }, fallback = "用户") {
  const name = typeof user.name === "string" ? user.name.trim() : "";
  if (name) return name;
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (email) return email.split("@")[0] || email;
  return fallback;
}

function getMemberDisplayName(member: any, fallback = "成员") {
  const remarkName = typeof member?.remarkName === "string" ? member.remarkName.trim() : "";
  if (remarkName) return remarkName;
  const displayName = typeof member?.displayName === "string" ? member.displayName.trim() : "";
  return displayName || fallback;
}

function getRoleDisplayName(role: string) {
  if (role === "SUB_ADMIN") return "子管理员";
  if (role === "ADMIN" || role === "OWNER") return "管理员";
  return "普通成员";
}

async function writeAuditLog({
  groupId,
  operatorId,
  type,
  targetType,
  targetId,
  summary,
  metadata = {},
  actorName,
  targetName,
  amount,
  beforeBalance,
  afterBalance,
  note,
  displayTitle,
  displayDetail
}: {
  groupId: string;
  operatorId: string;
  type: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  actorName?: string;
  targetName?: string;
  amount?: number;
  beforeBalance?: number;
  afterBalance?: number;
  note?: string;
  displayTitle?: string;
  displayDetail?: string;
}) {
  await adminDb.collection("AuditLogs").doc().set({
    groupId,
    operatorId,
    type,
    targetType: targetType || null,
    targetId: targetId || null,
    summary,
    metadata,
    actorName: actorName || null,
    targetName: targetName || null,
    amount: typeof amount === "number" ? amount : null,
    beforeBalance: typeof beforeBalance === "number" ? beforeBalance : null,
    afterBalance: typeof afterBalance === "number" ? afterBalance : null,
    note: note || null,
    displayTitle: displayTitle || null,
    displayDetail: displayDetail || null,
    createdAt: FieldValue.serverTimestamp()
  });
}

export async function POST(request: Request) {
  const user = await verifyUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { action, collection, docId, data, where, orderBy, limit } = body;
    const actorName = getUserDisplayName(user);

    if (action === "query") {
      const allowedFields = ALLOWED_QUERY_FIELDS[collection];
      const clauses = parseWhereClauses(where);
      const safeLimit = getSafeQueryLimit(limit);
      if (!allowedFields || !clauses || safeLimit === null) {
        return NextResponse.json({ error: "Invalid query" }, { status: 400 });
      }
      if (clauses.some((clause) => !allowedFields.has(clause[0]))) {
        return NextResponse.json({ error: "Query field is not allowed" }, { status: 400 });
      }
      if (orderBy && (!Array.isArray(orderBy) || orderBy[0] !== "createdAt" || ![undefined, "asc", "desc"].includes(orderBy[1]))) {
        return NextResponse.json({ error: "Invalid order" }, { status: 400 });
      }

      const groupId = getEqualityValue(clauses, "groupId");
      const requestedUserId = getEqualityValue(clauses, "userId");
      const requesterId = getEqualityValue(clauses, "requesterId");
      const isGlobalAdminQuery = (collection === "Users" || collection === "Groups") && clauses.length === 0;
      if (isGlobalAdminQuery && !(await isSuperAdmin(user.uid))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (["Members", "Records", "ClaimRequests", "AuditLogs"].includes(collection) && typeof groupId !== "string") {
        return NextResponse.json({ error: "A groupId filter is required" }, { status: 400 });
      }
      if (collection === "Members" && requestedUserId && requestedUserId !== user.uid && !(await canManageGroup(String(groupId), user.uid))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (collection === "ClaimRequests" && requesterId !== user.uid && !(await canManageGroup(String(groupId), user.uid))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (collection === "AuditLogs" && !(await canManageGroup(String(groupId), user.uid))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const ref = adminDb.collection(collection);
      let query: Query = ref;
      for (const clause of clauses) {
        const val = clause[2] === "user.uid" ? user.uid : clause[2];
        query = query.where(clause[0], clause[1], val);
      }
      if (orderBy) {
        query = query.orderBy(orderBy[0], orderBy[1] || "asc");
      }
      query = query.limit(safeLimit);
      const snapshot = await query.get();
      const docs = snapshot.docs.map((d: any) => serializeFirestore({ id: d.id, ...d.data() }));
      return NextResponse.json({ docs });
    } 
    else if (action === "get") {
      if (!ALLOWED_GET_COLLECTIONS.has(collection) || typeof docId !== "string" || !docId) {
        return NextResponse.json({ error: "Invalid document request" }, { status: 400 });
      }
      if (collection === "SuperAdmins" && docId !== user.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const ref = adminDb.collection(collection);
      const docSnap = await ref.doc(docId).get();
      if (!docSnap.exists) return NextResponse.json({ doc: null });
      const value = { id: docSnap.id, ...docSnap.data() } as Record<string, unknown>;
      if (collection === "Users" && docId !== user.uid) {
        return NextResponse.json({ doc: serializeFirestore({
          id: value.id, uid: value.uid,
          displayName: value.displayName, photoURL: value.photoURL
        }) });
      }
      return NextResponse.json({ doc: serializeFirestore(value) });
    }
    else if (action === "add") {
      const allowedMemberKeys = new Set(["groupId", "userId", "role", "remarkName", "balance", "totalAdded"]);
      if (collection !== "Members" || !hasOnlyKeys(data, allowedMemberKeys)
        || data.userId !== user.uid || data.role !== "MEMBER"
        || data.balance !== 0 || data.totalAdded !== 0 || typeof data.groupId !== "string"
        || typeof data.remarkName !== "string" || !data.remarkName.trim()
        || data.remarkName.trim().length > 20) {
        return NextResponse.json({ error: "Invalid member data" }, { status: 400 });
      }
      const groupSnap = await adminDb.collection("Groups").doc(data.groupId).get();
      if (!groupSnap.exists) return NextResponse.json({ error: "Group not found" }, { status: 404 });
      const existingMember = await adminDb.collection("Members")
        .where("groupId", "==", data.groupId).where("userId", "==", user.uid).limit(1).get();
      if (!existingMember.empty) return NextResponse.json({ error: "User already joined this group" }, { status: 409 });
      const newRef = adminDb.collection("Members").doc();
      await newRef.set(resolveSentinels({ ...data, createdAt: FieldValue.serverTimestamp() }));
      return NextResponse.json({ id: newRef.id });
    }
    else if (action === "set") {
      return NextResponse.json({ error: "Generic set is not allowed" }, { status: 403 });
    }
    else if (action === "update") {
      const allowedUserKeys = new Set(["groupMemberSortOption"]);
      if (collection !== "Users" || docId !== user.uid || !hasOnlyKeys(data, allowedUserKeys)
        || !["time", "name", "balance"].includes(data.groupMemberSortOption)) {
        return NextResponse.json({ error: "Invalid user update" }, { status: 400 });
      }
      await adminDb.collection("Users").doc(user.uid).update(resolveSentinels({ ...data, updatedAt: FieldValue.serverTimestamp() }));
      return NextResponse.json({ success: true });
    }
    else if (action === "delete") {
      return NextResponse.json({ error: "Generic delete is not allowed" }, { status: 403 });
    }
    else if (action === "batchDeleteGroup") {
      const groupSnap = await adminDb.collection("Groups").doc(docId).get();
      if (!groupSnap.exists) return NextResponse.json({ error: "Group not found" }, { status: 404 });
      const group = groupSnap.data();
      const ownsGroup = group?.creatorId === user.uid || group?.createdBy === user.uid;
      if (!ownsGroup && !(await isSuperAdmin(user.uid))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const batch = adminDb.batch();
      const membersSnap = await adminDb.collection("Members").where("groupId", "==", docId).get();
      membersSnap.forEach((memberDoc) => batch.delete(memberDoc.ref));

      const recordsSnap = await adminDb.collection("Records").where("groupId", "==", docId).get();
      recordsSnap.forEach((recordDoc) => batch.delete(recordDoc.ref));

      batch.delete(groupSnap.ref);
      await batch.commit();
      return NextResponse.json({ success: true });
    }
    else if (action === "transferCreator") {
      if (!(await isSuperAdmin(user.uid))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const { memberId, newCreatorId } = data || {};
      const batch = adminDb.batch();
      batch.update(adminDb.collection("Groups").doc(docId), { creatorId: newCreatorId, updatedAt: FieldValue.serverTimestamp() });
      batch.update(adminDb.collection("Members").doc(memberId), { role: "ADMIN", updatedAt: FieldValue.serverTimestamp() });
      await batch.commit();
      await writeAuditLog({
        groupId: docId,
        operatorId: user.uid,
        type: "CREATOR_TRANSFER",
        targetType: "member",
        targetId: memberId,
        summary: "超管移交群主",
        metadata: { newCreatorId },
        actorName,
        targetName: newCreatorId,
        displayTitle: `${actorName}移交了群主身份`,
        displayDetail: "群组创建人已更新，原群主权限同步调整为管理员。"
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "addMember") {
      const { groupId, remarkName } = data || {};
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const trimmedName = typeof remarkName === "string" ? remarkName.trim().slice(0, 20) : "";
      if (!trimmedName) return NextResponse.json({ error: "Invalid member name" }, { status: 400 });

      const memberRef = adminDb.collection("Members").doc();
      await memberRef.set({
        groupId,
        userId: null,
        role: "MEMBER",
        remarkName: trimmedName,
        balance: 0,
        totalAdded: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "MEMBER_ADDED",
        targetType: "member",
        targetId: memberRef.id,
        summary: `新增成员：${trimmedName}`,
        actorName,
        targetName: trimmedName,
        displayTitle: `${actorName}新增了成员 ${trimmedName}`,
        displayDetail: "新增成员卡片后，可由本人认领或由管理员代为记账。"
      });
      return NextResponse.json({ success: true, id: memberRef.id });
    }
    else if (action === "updateGroupBasic") {
      const { groupId, name, unit, announcement } = data || {};
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await adminDb.collection("Groups").doc(groupId).update({
        name: String(name || "").trim(),
        unit: String(unit || "").trim(),
        announcement: String(announcement || "").trim(),
        updatedAt: FieldValue.serverTimestamp()
      });
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "GROUP_SETTINGS_UPDATED",
        targetType: "group",
        targetId: groupId,
        summary: "更新群组基础设置",
        actorName,
        targetName: String(name || "").trim(),
        displayTitle: `${actorName}更新了群组基础设置`,
        displayDetail: `群组名称：${String(name || "").trim() || "未填写"}；单位：${String(unit || "").trim() || "未填写"}`
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "updateGroupClaimApproval") {
      const { groupId, requireClaimApproval } = data || {};
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await adminDb.collection("Groups").doc(groupId).update({
        requireClaimApproval: !!requireClaimApproval,
        updatedAt: FieldValue.serverTimestamp()
      });
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "CLAIM_APPROVAL_SETTING_UPDATED",
        targetType: "group",
        targetId: groupId,
        summary: !!requireClaimApproval ? "开启认领审核" : "关闭认领审核",
        actorName,
        displayTitle: `${actorName}${requireClaimApproval ? "开启" : "关闭"}了认领审核`,
        displayDetail: requireClaimApproval ? "成员认领需要管理员审核通过后生效。" : "成员可以直接认领空白成员卡片。"
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "updateGroupInterest") {
      const { groupId, interestConfig } = data || {};
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const isEnabled = interestConfig?.type !== "none" && interestConfig?.frequency !== "none";
      const nextInterestDate = isEnabled ? parseFirestoreDate(interestConfig?.nextInterestAt) : null;
      const currentMinute = new Date();
      currentMinute.setSeconds(0, 0);
      if (isEnabled && (!nextInterestDate || nextInterestDate.getTime() < currentMinute.getTime())) {
        return NextResponse.json({ error: "下一次计息时间必须设置为当前或未来时间" }, { status: 400 });
      }
      const scheduleAnchor = nextInterestDate
        ? normalizeInterestScheduleAnchor(interestConfig?.scheduleAnchor, nextInterestDate)
        : null;
      const nextConfig = resolveSentinels({
        ...interestConfig,
        rate: Number(interestConfig?.rate) || 0,
        fixedAmount: Number(interestConfig?.fixedAmount) || 0,
        nextInterestAt: nextInterestDate ? nextInterestDate.toISOString() : null,
        lastCalculatedAt: null,
        scheduleAnchor
      });
      await adminDb.collection("Groups").doc(groupId).update({
        interestConfig: nextConfig,
        updatedAt: FieldValue.serverTimestamp()
      });
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "INTEREST_SETTINGS_UPDATED",
        targetType: "group",
        targetId: groupId,
        summary: "更新计息规则",
        metadata: { type: interestConfig?.type, frequency: interestConfig?.frequency, rate: Number(interestConfig?.rate) || 0, fixedAmount: Number(interestConfig?.fixedAmount) || 0, nextInterestAt: nextInterestDate?.toISOString() || null, scheduleAnchor },
        actorName,
        displayTitle: `${actorName}更新了计息规则`,
        displayDetail: `类型：${interestConfig?.type || "none"}；频率：${interestConfig?.frequency || "none"}；利率：${Number(interestConfig?.rate) || 0}%；固定数量：${Number(interestConfig?.fixedAmount) || 0}`
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "updateMemberRole") {
      const { groupId, memberId, role } = data || {};
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!["MEMBER", "ADMIN", "SUB_ADMIN"].includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      const memberSnap = await adminDb.collection("Members").doc(memberId).get();
      const memberName = getMemberDisplayName(memberSnap.data());
      await adminDb.collection("Members").doc(memberId).update({
        role,
        updatedAt: FieldValue.serverTimestamp()
      });
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "MEMBER_ROLE_UPDATED",
        targetType: "member",
        targetId: memberId,
        summary: `调整成员权限为 ${role}`,
        actorName,
        targetName: memberName,
        displayTitle: `${actorName}将${memberName}的权限调整为${getRoleDisplayName(role)}`,
        displayDetail: `新的成员权限：${getRoleDisplayName(role)}`
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "updateMemberName") {
      const { groupId, memberId, remarkName } = data || {};
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const trimmedName = typeof remarkName === "string" ? remarkName.trim().slice(0, 20) : "";
      if (!trimmedName) return NextResponse.json({ error: "Invalid member name" }, { status: 400 });
      const memberSnap = await adminDb.collection("Members").doc(memberId).get();
      const oldName = getMemberDisplayName(memberSnap.data());
      await adminDb.collection("Members").doc(memberId).update({
        remarkName: trimmedName,
        updatedAt: FieldValue.serverTimestamp()
      });
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "MEMBER_NAME_UPDATED",
        targetType: "member",
        targetId: memberId,
        summary: `修改成员昵称：${trimmedName}`,
        actorName,
        targetName: trimmedName,
        displayTitle: `${actorName}将${oldName}昵称改为${trimmedName}`,
        displayDetail: `原昵称：${oldName}；新昵称：${trimmedName}`
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "unbindMember") {
      const { groupId, memberId } = data || {};
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const memberSnap = await adminDb.collection("Members").doc(memberId).get();
      const memberName = getMemberDisplayName(memberSnap.data());
      await adminDb.collection("Members").doc(memberId).update({
        userId: null,
        updatedAt: FieldValue.serverTimestamp()
      });
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "MEMBER_UNBOUND",
        targetType: "member",
        targetId: memberId,
        summary: "强制解绑成员账号",
        actorName,
        targetName: memberName,
        displayTitle: `${actorName}解绑了${memberName}的账号`,
        displayDetail: "该成员卡片恢复为未认领状态，历史流水保留。"
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "deleteMember") {
      const { groupId, memberId } = data || {};
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const memberSnap = await adminDb.collection("Members").doc(memberId).get();
      const memberName = getMemberDisplayName(memberSnap.data());
      await adminDb.collection("Members").doc(memberId).delete();
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "MEMBER_DELETED",
        targetType: "member",
        targetId: memberId,
        summary: "删除成员卡片",
        actorName,
        targetName: memberName,
        displayTitle: `${actorName}删除了成员 ${memberName}`,
        displayDetail: "成员卡片已删除，相关历史记录可能仍保留在流水中。"
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "quickAddRecord") {
      const { memberId, groupId } = data || {};
      const memberRef = adminDb.collection("Members").doc(memberId);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists) return NextResponse.json({ error: "Member not found" }, { status: 404 });
      const member = memberSnap.data();
      if (member?.groupId !== groupId) return NextResponse.json({ error: "Invalid member group" }, { status: 400 });
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const memberName = getMemberDisplayName(member);
      const beforeBalance = Number(member?.balance || 0);
      const afterBalance = beforeBalance + 1;

      const recordRef = adminDb.collection("Records").doc();
      await adminDb.runTransaction(async (transaction) => {
        transaction.update(memberRef, {
          balance: FieldValue.increment(1),
          totalAdded: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp()
        });
        transaction.set(recordRef, {
          groupId,
          memberId,
          operatorId: user.uid,
          type: "ADD",
          amount: 1,
          note: "",
          createdAt: FieldValue.serverTimestamp()
        });
      });
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "BALANCE_ADD",
        targetType: "member",
        targetId: memberId,
        summary: "快速增加 1",
        metadata: { amount: 1 },
        actorName,
        targetName: memberName,
        amount: 1,
        beforeBalance,
        afterBalance,
        displayTitle: `${actorName}给${memberName}快速记了一笔 +1`,
        displayDetail: `余额从 ${beforeBalance} 调整为 ${afterBalance}`
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "submitRecord") {
      const { memberId, groupId, recordActionType, amount, note } = data || {};
      const memberRef = adminDb.collection("Members").doc(memberId);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists) return NextResponse.json({ error: "Member not found" }, { status: 404 });
      const member = memberSnap.data();
      if (member?.groupId !== groupId) return NextResponse.json({ error: "Invalid member group" }, { status: 400 });
      const isOwnRecord = member?.userId === user.uid;
      const isManager = await canManageGroup(groupId, user.uid);
      if (recordActionType === "ADD" && !isOwnRecord && !isManager) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if ((recordActionType === "DEDUCT" || recordActionType === "SET") && !isManager) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const memberName = getMemberDisplayName(member);
      const cleanedNote = typeof note === "string" ? note.trim().slice(0, 200) : "";
      let beforeBalance = 0;
      let afterBalance = 0;

      await adminDb.runTransaction(async (transaction) => {
        const memberDoc = await transaction.get(memberRef);
        if (!memberDoc.exists) throw new Error("成员不存在");

        const currentBalance = Number(memberDoc.data()?.balance || 0);
        let newBalance = currentBalance;
        let newTotalAdded = Number(memberDoc.data()?.totalAdded ?? currentBalance);

        if (recordActionType === "ADD") {
          newBalance += amount;
          newTotalAdded += amount;
        } else if (recordActionType === "DEDUCT") {
          newBalance -= amount;
          if (newBalance < 0) throw new Error("余额不能为负数");
        } else if (recordActionType === "SET") {
          if (amount > currentBalance) newTotalAdded += amount - currentBalance;
          newBalance = amount;
        }
        beforeBalance = currentBalance;
        afterBalance = newBalance;

        transaction.update(memberRef, {
          balance: newBalance,
          totalAdded: newTotalAdded,
          updatedAt: FieldValue.serverTimestamp()
        });
        transaction.set(adminDb.collection("Records").doc(), {
          groupId,
          memberId,
          operatorId: user.uid,
          type: recordActionType,
          amount: recordActionType === "SET" ? newBalance : amount,
          note: cleanedNote,
          createdAt: FieldValue.serverTimestamp()
        });
      });
      const actionTitle = recordActionType === "ADD"
        ? `${actorName}给${memberName}记了一笔 +${amount}`
        : recordActionType === "DEDUCT"
          ? `${actorName}为${memberName}核销了 ${amount}`
          : `${actorName}将${memberName}余额调为 ${afterBalance}`;
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: recordActionType === "ADD" ? "BALANCE_ADD" : recordActionType === "DEDUCT" ? "BALANCE_DEDUCT" : "BALANCE_SET",
        targetType: "member",
        targetId: memberId,
        summary: `调整成员余额：${recordActionType}`,
        metadata: {
          amount,
          note: cleanedNote
        },
        actorName,
        targetName: memberName,
        amount: recordActionType === "SET" ? afterBalance : amount,
        beforeBalance,
        afterBalance,
        note: cleanedNote,
        displayTitle: actionTitle,
        displayDetail: `余额从 ${beforeBalance} 调整为 ${afterBalance}`
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "requestClaim") {
      const { groupId, memberId } = data || {};
      const groupSnap = await adminDb.collection("Groups").doc(groupId).get();
      if (!groupSnap.exists) return NextResponse.json({ error: "Group not found" }, { status: 404 });

      const memberRef = adminDb.collection("Members").doc(memberId);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists) return NextResponse.json({ error: "Member not found" }, { status: 404 });
      const member = memberSnap.data();
      if (member?.groupId !== groupId) return NextResponse.json({ error: "Invalid member group" }, { status: 400 });
      if (member?.userId) return NextResponse.json({ error: "Member already claimed" }, { status: 409 });

      const existingMember = await adminDb.collection("Members")
        .where("groupId", "==", groupId)
        .where("userId", "==", user.uid)
        .limit(1)
        .get();
      if (!existingMember.empty) return NextResponse.json({ error: "User already joined this group" }, { status: 409 });

      const group = groupSnap.data();
      const memberName = getMemberDisplayName(member);
      if (!group?.requireClaimApproval) {
        await memberRef.update({
          userId: user.uid,
          updatedAt: FieldValue.serverTimestamp()
        });
        await writeAuditLog({
          groupId,
          operatorId: user.uid,
          type: "MEMBER_CLAIMED",
          targetType: "member",
          targetId: memberId,
          summary: "成员完成认领",
          metadata: { approvalRequired: false },
          actorName,
          targetName: memberName,
          displayTitle: `${actorName}认领了成员 ${memberName}`,
          displayDetail: "该成员卡片已绑定到当前账号。"
        });
        return NextResponse.json({ success: true, status: "APPROVED" });
      }

      const pendingSnap = await adminDb.collection("ClaimRequests")
        .where("groupId", "==", groupId)
        .where("memberId", "==", memberId)
        .where("requesterId", "==", user.uid)
        .where("status", "==", "PENDING")
        .limit(1)
        .get();
      if (!pendingSnap.empty) return NextResponse.json({ success: true, status: "PENDING" });

      await adminDb.collection("ClaimRequests").doc().set({
        groupId,
        memberId,
        memberName: member?.remarkName || "",
        requesterId: user.uid,
        requesterEmail: user.email || "",
        requesterName: user.name || "",
        status: "PENDING",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: "CLAIM_REQUESTED",
        targetType: "member",
        targetId: memberId,
        summary: "提交成员认领申请",
        actorName,
        targetName: memberName,
        displayTitle: `${actorName}提交了${memberName}的认领申请`,
        displayDetail: "申请已进入待审核列表。"
      });
      return NextResponse.json({ success: true, status: "PENDING" });
    }
    else if (action === "reviewClaim") {
      const { requestId, decision } = data || {};
      const requestRef = adminDb.collection("ClaimRequests").doc(requestId);
      const requestSnap = await requestRef.get();
      if (!requestSnap.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });
      const claim = requestSnap.data();
      const groupId = claim?.groupId;
      if (!(await canManageGroup(groupId, user.uid))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (claim?.status !== "PENDING") return NextResponse.json({ error: "Request already reviewed" }, { status: 409 });

      if (decision === "APPROVED") {
        const memberRef = adminDb.collection("Members").doc(claim.memberId);
        await adminDb.runTransaction(async (transaction) => {
          const memberDoc = await transaction.get(memberRef);
          if (!memberDoc.exists) throw new Error("Member not found");
          if (memberDoc.data()?.userId) throw new Error("Member already claimed");
          transaction.update(memberRef, {
            userId: claim.requesterId,
            updatedAt: FieldValue.serverTimestamp()
          });
          transaction.update(requestRef, {
            status: "APPROVED",
            reviewerId: user.uid,
            updatedAt: FieldValue.serverTimestamp()
          });
        });
      } else {
        await requestRef.update({
          status: "REJECTED",
          reviewerId: user.uid,
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      await writeAuditLog({
        groupId,
        operatorId: user.uid,
        type: decision === "APPROVED" ? "CLAIM_APPROVED" : "CLAIM_REJECTED",
        targetType: "claimRequest",
        targetId: requestId,
        summary: decision === "APPROVED" ? "通过成员认领申请" : "拒绝成员认领申请",
        metadata: { memberId: claim.memberId, requesterId: claim.requesterId },
        actorName,
        targetName: claim.memberName || claim.memberId,
        displayTitle: decision === "APPROVED"
          ? `${actorName}通过了${claim.memberName || "成员"}的认领申请`
          : `${actorName}拒绝了${claim.memberName || "成员"}的认领申请`,
        displayDetail: `申请人：${claim.requesterName || claim.requesterEmail || claim.requesterId || "未知用户"}`
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "updateProfile") {
      await adminAuth.updateUser(user.uid, {
        displayName: data.displayName || undefined,
        photoURL: null
      });
      await adminDb.collection("Users").doc(user.uid).set(resolveSentinels({
        uid: user.uid,
        email: user.email || null,
        displayName: data.displayName,
        photoURL: null,
        updatedAt: FieldValue.serverTimestamp()
      }), { merge: true });
      return NextResponse.json({ success: true });
    }
    else if (action === "transaction_interest") {
      const groupRef = adminDb.collection("Groups").doc(docId);
      const now = new Date();
      let appliedMemberCount = 0;
      let appliedTotalInterest = 0;
      let appliedPeriods = 0;
      let appliedFromIso = "";
      let appliedToIso = "";
      let nextInterestIso = "";
      await adminDb.runTransaction(async (transaction) => {
        const freshGroup = await transaction.get(groupRef);
        if (!freshGroup.exists) return;
        const freshConfig = freshGroup.data()?.interestConfig;
        if (!freshConfig || freshConfig.type === "none" || freshConfig.frequency === "none" || !freshConfig.nextInterestAt) return;

        const nextInterestDate = parseFirestoreDate(freshConfig.nextInterestAt);
        if (!nextInterestDate || now.getTime() < nextInterestDate.getTime()) return;
        const freq = freshConfig.frequency as InterestFrequency;
        const schedule = getDueInterestSchedule(nextInterestDate, now, freq, freshConfig.scheduleAnchor);
        if (!schedule) return;
        const freshPeriods = schedule.periods;
        appliedPeriods = freshPeriods;
        appliedFromIso = nextInterestDate.toISOString();

        const lastCalculatedTime = schedule.lastDueAt;
        const newNextInterestTime = schedule.nextDueAt;
        appliedToIso = lastCalculatedTime.toISOString();
        nextInterestIso = newNextInterestTime.toISOString();

        const membersQuery = adminDb.collection("Members").where("groupId", "==", docId);
        const membersSnap = await transaction.get(membersQuery);
        const rate = Number(freshConfig.rate || 0) / 100;
        const fixedAmount = Number(freshConfig.fixedAmount || 0);
        const isCompound = freshConfig.type === "compound";
        const isFixed = freshConfig.type === "fixed";
        let transactionMemberCount = 0;
        let transactionTotalInterest = 0;

        membersSnap.forEach((memberDoc) => {
          const member = memberDoc.data();
          if (member.balance > 0) {
            let newBalance = Number(member.balance || 0);
            let totalInterest = 0;

            for (let i = 0; i < freshPeriods; i++) {
              const interestForPeriod = isFixed ? fixedAmount : isCompound ? newBalance * rate : Number(member.balance || 0) * rate;
              totalInterest += interestForPeriod;
              newBalance += interestForPeriod;
            }

            totalInterest = Number(totalInterest.toFixed(2));
            newBalance = Number(newBalance.toFixed(2));

            if (totalInterest > 0) {
              transaction.update(memberDoc.ref, {
                balance: newBalance,
                totalAdded: Number(member.totalAdded ?? member.balance) + totalInterest,
                updatedAt: FieldValue.serverTimestamp()
              });
              transaction.set(adminDb.collection("Records").doc(), {
                groupId: docId,
                memberId: memberDoc.id,
                operatorId: "SYSTEM",
                type: "INTEREST",
                amount: totalInterest,
                createdAt: FieldValue.serverTimestamp()
              });
              transactionMemberCount += 1;
              transactionTotalInterest += totalInterest;
            }
          }
        });

        transaction.update(groupRef, {
          "interestConfig.lastCalculatedAt": lastCalculatedTime,
          "interestConfig.nextInterestAt": newNextInterestTime
        });
        appliedMemberCount = transactionMemberCount;
        appliedTotalInterest = transactionTotalInterest;
      });
      if (appliedMemberCount > 0 && appliedTotalInterest > 0) {
        const totalInterest = Number(appliedTotalInterest.toFixed(2));
        await writeAuditLog({
          groupId: docId,
          operatorId: "SYSTEM",
          type: "INTEREST_APPLIED",
          targetType: "group",
          targetId: docId,
          summary: "系统完成自动计息",
          metadata: {
            memberCount: appliedMemberCount,
            totalInterest,
            periods: appliedPeriods,
            from: appliedFromIso || null,
            to: appliedToIso || null,
            nextInterestAt: nextInterestIso || null
          },
          actorName: "系统",
          amount: totalInterest,
          displayTitle: `系统完成自动计息，共 ${appliedMemberCount} 名成员增加 ${totalInterest}`,
          displayDetail: `结息周期：${appliedPeriods}；首次触发：${appliedFromIso.slice(0, 16).replace("T", " ") || "-"}；结算到：${appliedToIso.slice(0, 16).replace("T", " ") || "-"}；下次计息：${nextInterestIso.slice(0, 16).replace("T", " ") || "-"}`
        });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("DB Proxy Error:", error);
    return NextResponse.json({ error: error.message || "Internal Error" }, { status: 500 });
  }
}
