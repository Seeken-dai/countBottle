import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/auth-server";
import { FieldValue, type Query } from "firebase-admin/firestore";

export const runtime = "nodejs";

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

async function isSuperAdmin(uid: string) {
  const snap = await adminDb.collection("SuperAdmins").doc(uid).get();
  return snap.exists;
}

export async function POST(request: Request) {
  const user = await verifyUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { action, collection, docId, data, where, orderBy, limit } = body;

    if (action === "query") {
      const ref = adminDb.collection(collection);
      let query: Query = ref;
      if (where) {
        where.forEach((w: any) => {
          // Resolve special variable 'user.uid'
          const val = w[2] === "user.uid" ? user.uid : w[2];
          query = query.where(w[0], w[1], val);
        });
      }
      if (orderBy) {
        query = query.orderBy(orderBy[0], orderBy[1] || "asc");
      }
      if (limit) {
        query = query.limit(limit);
      }
      const snapshot = await query.get();
      const docs = snapshot.docs.map((d: any) => serializeFirestore({ id: d.id, ...d.data() }));
      return NextResponse.json({ docs });
    } 
    else if (action === "get") {
      const ref = adminDb.collection(collection);
      const docSnap = await ref.doc(docId).get();
      if (!docSnap.exists) return NextResponse.json({ doc: null });
      return NextResponse.json({ doc: serializeFirestore({ id: docSnap.id, ...docSnap.data() }) });
    }
    else if (action === "add") {
      const ref = adminDb.collection(collection);
      const newRef = ref.doc();
      const payload = resolveSentinels({ ...data, createdAt: data?.createdAt || FieldValue.serverTimestamp() });
      await newRef.set(payload);
      return NextResponse.json({ id: newRef.id });
    }
    else if (action === "set") {
      const ref = adminDb.collection(collection);
      await ref.doc(docId).set(resolveSentinels(data), { merge: body.merge !== false });
      return NextResponse.json({ success: true });
    }
    else if (action === "update") {
      const ref = adminDb.collection(collection);
      await ref.doc(docId).update(resolveSentinels({ ...data, updatedAt: FieldValue.serverTimestamp() }));
      return NextResponse.json({ success: true });
    }
    else if (action === "delete") {
      const ref = adminDb.collection(collection);
      await ref.doc(docId).delete();
      return NextResponse.json({ success: true });
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
      return NextResponse.json({ success: true });
    }
    else if (action === "quickAddRecord") {
      const { memberId, groupId } = data || {};
      const memberRef = adminDb.collection("Members").doc(memberId);
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
          createdAt: FieldValue.serverTimestamp()
        });
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "submitRecord") {
      const { memberId, groupId, recordActionType, amount } = data || {};
      const memberRef = adminDb.collection("Members").doc(memberId);
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
          createdAt: FieldValue.serverTimestamp()
        });
      });
      return NextResponse.json({ success: true });
    }
    else if (action === "updateProfile") {
      await adminAuth.updateUser(user.uid, {
        displayName: data.displayName || undefined,
        photoURL: data.photoURL || undefined
      });
      await adminDb.collection("Users").doc(user.uid).set(resolveSentinels({
        uid: user.uid,
        email: user.email || null,
        displayName: data.displayName,
        photoURL: data.photoURL,
        updatedAt: FieldValue.serverTimestamp()
      }), { merge: true });
      return NextResponse.json({ success: true });
    }
    else if (action === "transaction_interest") {
      const groupRef = adminDb.collection("Groups").doc(docId);
      const now = new Date();
      await adminDb.runTransaction(async (transaction) => {
        const freshGroup = await transaction.get(groupRef);
        if (!freshGroup.exists) return;
        const freshConfig = freshGroup.data()?.interestConfig;
        if (!freshConfig || freshConfig.type === "none" || freshConfig.frequency === "none" || !freshConfig.lastCalculatedAt) return;

        const rawLast = freshConfig.lastCalculatedAt;
        const freshLastDate = typeof rawLast.toDate === "function" ? rawLast.toDate() : new Date(rawLast);
        const days = (now.getTime() - freshLastDate.getTime()) / (1000 * 60 * 60 * 24);
        const freq = freshConfig.frequency;
        let freshPeriods = 0;
        if (freq === "daily") freshPeriods = Math.floor(days);
        else if (freq === "weekly") freshPeriods = Math.floor(days / 7);
        else if (freq === "monthly") freshPeriods = Math.floor(days / 30);
        else if (freq === "yearly") freshPeriods = Math.floor(days / 365);
        if (freshPeriods < 1) return;

        const msPerPeriod = {
          daily: 86400000,
          weekly: 604800000,
          monthly: 2592000000,
          yearly: 31536000000
        }[freq] as number;
        const newLastCalculatedTime = new Date(freshLastDate.getTime() + freshPeriods * msPerPeriod);

        const membersQuery = adminDb.collection("Members").where("groupId", "==", docId);
        const membersSnap = await transaction.get(membersQuery);
        const rate = Number(freshConfig.rate || 0) / 100;
        const isCompound = freshConfig.type === "compound";

        membersSnap.forEach((memberDoc) => {
          const member = memberDoc.data();
          if (member.balance > 0) {
            let newBalance = Number(member.balance || 0);
            let totalInterest = 0;

            for (let i = 0; i < freshPeriods; i++) {
              const interestForPeriod = isCompound ? newBalance * rate : Number(member.balance || 0) * rate;
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
            }
          }
        });

        transaction.update(groupRef, {
          "interestConfig.lastCalculatedAt": newLastCalculatedTime
        });
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("DB Proxy Error:", error);
    return NextResponse.json({ error: error.message || "Internal Error" }, { status: 500 });
  }
}
