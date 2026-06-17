import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyUser } from "@/lib/auth-server";

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
        groupsData.push({
          id: groupSnap.id,
          ...groupSnap.data(),
          myBalance: memberData.balance,
          role: memberData.role
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
    const newGroup = {
      id: groupRef.id,
      name,
      currency,
      description: description || "",
      createdBy: user.uid,
      createdAt: new Date().toISOString(),
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
      createdAt: new Date().toISOString()
    });

    return NextResponse.json({ group: newGroup });
  } catch (error) {
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
