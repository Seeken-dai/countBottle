import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/auth-server";

export async function POST(request: Request) {
  const user = await verifyUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { action, collection, docId, data, where, orderBy, limit } = body;

    let ref: any = adminDb.collection(collection);

    if (action === "query") {
      if (where) {
        where.forEach((w: any) => {
          // Resolve special variable 'user.uid'
          const val = w[2] === "user.uid" ? user.uid : w[2];
          ref = ref.where(w[0], w[1], val);
        });
      }
      if (orderBy) {
        ref = ref.orderBy(orderBy[0], orderBy[1] || "asc");
      }
      if (limit) {
        ref = ref.limit(limit);
      }
      const snapshot = await ref.get();
      const docs = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      return NextResponse.json({ docs });
    } 
    else if (action === "get") {
      const docSnap = await ref.doc(docId).get();
      if (!docSnap.exists) return NextResponse.json({ doc: null });
      return NextResponse.json({ doc: { id: docSnap.id, ...docSnap.data() } });
    }
    else if (action === "add") {
      const newRef = ref.doc();
      const payload = { ...data, createdAt: new Date().toISOString() };
      await newRef.set(payload);
      return NextResponse.json({ id: newRef.id, ...payload });
    }
    else if (action === "update") {
      await ref.doc(docId).update({ ...data, updatedAt: new Date().toISOString() });
      return NextResponse.json({ success: true });
    }
    else if (action === "delete") {
      await ref.doc(docId).delete();
      return NextResponse.json({ success: true });
    }
    else if (action === "transaction_interest") {
      // Specialized transaction for interest
      const groupRef = adminDb.collection("Groups").doc(docId);
      await adminDb.runTransaction(async (transaction) => {
        const freshGroup = await transaction.get(groupRef);
        if (!freshGroup.exists) return;
        const freshConfig = freshGroup.data()?.interestConfig;
        transaction.update(groupRef, {
          "interestConfig.lastCalculatedAt": new Date().toISOString()
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
