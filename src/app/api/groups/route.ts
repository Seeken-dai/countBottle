import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/auth-server";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

export async function GET() {
  const user = await verifyUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const membersSnap = await adminDb.collection("Members").where("userId", "==", user.uid).get();
    
    // Also check if user is SuperAdmin
    const superAdminSnap = await adminDb.collection("SuperAdmins").doc(user.uid).get();
    const isSuperAdmin = superAdminSnap.exists;

    const groupsData = [];
    for (const docSnap of membersSnap.docs) {
      const memberData = docSnap.data();
      const groupSnap = await adminDb.collection("Groups").doc(memberData.groupId).get();
      if (groupSnap.exists) {
        const groupData = groupSnap.data() || {};
        const creatorId = groupData.creatorId || groupData.createdBy;
        const role = creatorId === user.uid
          ? "OWNER"
          : ["OWNER", "ADMIN", "SUB_ADMIN"].includes(memberData.role)
            ? "SUB_ADMIN"
            : "MEMBER";
        groupsData.push({
          id: groupSnap.id,
          ...groupData,
          creatorId,
          unit: groupData.unit || groupData.currency || "瓶",
          myBalance: memberData.balance,
          role
        });
      }
    }

    return NextResponse.json({ groups: groupsData, isSuperAdmin });
  } catch (error) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await verifyUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { name, currency, description } = await request.json();
    const groupRef = adminDb.collection("Groups").doc();
    const unit = currency || "瓶";
    const newGroup = {
      id: groupRef.id,
      name,
      unit,
      currency: unit,
      description: description || "",
      creatorId: user.uid,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      members: [user.uid]
    };
    await groupRef.set(newGroup);

    // Add creator as the first member in Members collection
    const memberRef = adminDb.collection("Members").doc();
    await memberRef.set({
      groupId: groupRef.id,
      userId: user.uid,
      role: "OWNER",
      remarkName: user.name || user.email?.split("@")[0] || "群主",
      balance: 0,
      totalAdded: 0,
      createdAt: FieldValue.serverTimestamp()
    });

    return NextResponse.json({
      group: {
        id: groupRef.id,
        name,
        unit,
        currency: unit,
        description: description || "",
        creatorId: user.uid,
        createdBy: user.uid
      }
    });
  } catch (error) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
