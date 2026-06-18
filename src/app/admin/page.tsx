"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { proxyRequest, queryProxy, updateDocProxy } from "@/lib/useFirestore";
import { ThemeToggle } from "@/components/theme-toggle";
import { Modal } from "@/components/ui/modal";

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  createdAt: string;
}

interface GroupData {
  id: string;
  name: string;
  unit: string;
  currency?: string;
  creatorId: string;
  createdBy?: string;
  createdAt: any;
}

interface MemberData {
  id: string;
  groupId: string;
  userId: string | null;
  role: string;
  remarkName: string;
  displayName?: string;
  balance: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"groups" | "users">("groups");
  
  const [users, setUsers] = useState<UserData[]>([]);
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Group Details State
  const [selectedGroup, setSelectedGroup] = useState<GroupData | null>(null);
  const [groupMembers, setGroupMembers] = useState<MemberData[]>([]);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  useEffect(() => {
    fetchGlobalData();
  }, []);

  const fetchGlobalData = async () => {
    setIsLoading(true);
    try {
      // Fetch Users
      const usersData = await queryProxy("Users") as UserData[];
      // Sort users by createdAt desc
      usersData.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      setUsers(usersData);

      // Fetch Groups
      const groupsData = (await queryProxy("Groups") as GroupData[]).map(group => ({
        ...group,
        creatorId: group.creatorId || group.createdBy || "",
        unit: group.unit || group.currency || "瓶"
      }));
      // Sort groups by createdAt desc
      groupsData.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      setGroups(groupsData);
      
    } catch (err) {
      console.error("Error fetching admin data:", err);
      alert("拉取全局数据失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleManageGroup = async (group: GroupData) => {
    setSelectedGroup(group);
    setIsGroupModalOpen(true);
    setIsLoadingMembers(true);
    try {
      const membersData = await queryProxy("Members", [["groupId", "==", group.id]]) as MemberData[];
      
      // Merge user display names
      const mergedMembers = membersData.map(m => {
        if (m.userId) {
          const u = users.find(usr => usr.uid === m.userId);
          if (u) return { ...m, displayName: u.displayName };
        }
        return m;
      });
      
      setGroupMembers(mergedMembers);
    } catch (err) {
      console.error("Error fetching members:", err);
      alert("拉取成员失败");
    } finally {
      setIsLoadingMembers(false);
    }
  };

  const handleChangeCreator = async (member: MemberData) => {
    if (!selectedGroup) return;
    if (!member.userId) {
      alert("此成员卡片尚未被真实用户认领，不能作为群主");
      return;
    }
    if (member.userId === selectedGroup.creatorId) {
      alert("该成员已经是群主");
      return;
    }
    if (!confirm(`超级警告：是否强制将群主权限移交给「${member.remarkName}」？`)) return;

    setIsActionLoading(true);
    try {
      await proxyRequest({
        action: "transferCreator",
        docId: selectedGroup.id,
        data: { memberId: member.id, newCreatorId: member.userId }
      });

      // Update local state
      setSelectedGroup(prev => prev ? { ...prev, creatorId: member.userId! } : null);
      setGroups(prev => prev.map(g => g.id === selectedGroup.id ? { ...g, creatorId: member.userId! } : g));
      setGroupMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: "ADMIN" } : m));
      
      alert("移交成功！");
    } catch (err) {
      console.error("Error changing creator:", err);
      alert("移交失败");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleToggleAdmin = async (member: MemberData) => {
    if (!selectedGroup) return;
    if (member.userId === selectedGroup.creatorId) {
      alert("群主的管理员权限不可取消！如果要取消，请先移交群主。");
      return;
    }

    const newRole = member.role === "ADMIN" ? "MEMBER" : "ADMIN";
    if (!confirm(`确认将「${member.remarkName}」的权限修改为 ${newRole === 'ADMIN' ? '管理员' : '普通成员'} 吗？`)) return;

    setIsActionLoading(true);
    try {
      await updateDocProxy("Members", member.id, { role: newRole });
      setGroupMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
    } catch (err) {
      console.error("Error toggling role:", err);
      alert("操作失败");
    } finally {
      setIsActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md shadow-sm border-b border-gray-200 dark:border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/dashboard")} className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <span className="text-orange-500">👑</span>
              系统超管后台
            </h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Tabs */}
        <div className="flex space-x-1 bg-gray-200/50 dark:bg-gray-800/50 p-1 rounded-xl mb-8 w-max">
          <button
            onClick={() => setActiveTab("groups")}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === "groups" ? "bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"}`}
          >
            全局群组管理
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === "users" ? "bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"}`}
          >
            全局用户列表
          </button>
        </div>

        {/* Groups Tab */}
        {activeTab === "groups" && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
              <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">所有群组 ({groups.length})</h2>
              <button onClick={fetchGlobalData} className="text-sm font-bold text-primary hover:text-primary/80">刷新数据</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-6 py-3 font-medium">群组名称</th>
                    <th className="px-6 py-3 font-medium">群组 ID</th>
                    <th className="px-6 py-3 font-medium">单位</th>
                    <th className="px-6 py-3 font-medium">创建时间</th>
                    <th className="px-6 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {groups.map(group => (
                    <tr key={group.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-6 py-4 font-bold text-gray-900 dark:text-white">{group.name}</td>
                      <td className="px-6 py-4 text-gray-500 font-mono text-xs">{group.id}</td>
                      <td className="px-6 py-4 text-gray-500">{group.unit}</td>
                      <td className="px-6 py-4 text-gray-500">
                        {group.createdAt ? new Date(group.createdAt).toLocaleString() : "-"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleManageGroup(group)}
                          className="px-4 py-2 bg-primary/10 text-primary font-bold rounded-lg hover:bg-primary/20 transition-colors"
                        >
                          高级维护
                        </button>
                      </td>
                    </tr>
                  ))}
                  {groups.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">暂无群组</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
              <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">注册用户 ({users.length})</h2>
              <button onClick={fetchGlobalData} className="text-sm font-bold text-primary hover:text-primary/80">刷新数据</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-6 py-3 font-medium">用户信息</th>
                    <th className="px-6 py-3 font-medium">UID</th>
                    <th className="px-6 py-3 font-medium">邮箱</th>
                    <th className="px-6 py-3 font-medium">注册时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {users.map(u => (
                    <tr key={u.uid} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center font-bold text-gray-500 dark:text-gray-400 overflow-hidden shrink-0">
                            {(u.displayName || u.email || "U").charAt(0).toUpperCase()}
                          </div>
                          <span className="font-bold text-gray-900 dark:text-white">{u.displayName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-500 font-mono text-xs">{u.uid}</td>
                      <td className="px-6 py-4 text-gray-500">{u.email}</td>
                      <td className="px-6 py-4 text-gray-500">
                        {new Date(u.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">暂无用户</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>

      {/* Group Maintenance Modal */}
      <Modal isOpen={isGroupModalOpen} onClose={() => !isActionLoading && setIsGroupModalOpen(false)} title="群组高级维护" maxWidth="2xl">
        {selectedGroup && (
          <div className="space-y-6">
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
              <h3 className="font-extrabold text-gray-900 dark:text-white mb-1">{selectedGroup.name}</h3>
              <p className="text-sm text-gray-500 font-mono">ID: {selectedGroup.id}</p>
            </div>

            <div>
              <h4 className="font-bold text-gray-900 dark:text-white mb-4">成员与权限管理</h4>
              {isLoadingMembers ? (
                <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div></div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                  {groupMembers.map(member => {
                    const isCreator = member.userId === selectedGroup.creatorId;
                    return (
                      <div key={member.id} className={`flex items-center justify-between p-3 rounded-xl border ${isCreator ? 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800/30' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'}`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <h5 className="font-bold text-gray-900 dark:text-white">{member.remarkName}</h5>
                            {isCreator && <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-orange-500 text-white">群主</span>}
                            {!isCreator && member.role === "ADMIN" && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">副管</span>}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {member.userId ? (member.displayName ? `绑: ${member.displayName}` : "已绑定真实用户") : "空白卡片(未认领)"} 
                            {" · "}
                            余额: {member.balance}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {!isCreator && (
                            <button
                              onClick={() => handleToggleAdmin(member)}
                              disabled={isActionLoading}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${member.role === 'ADMIN' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700' : 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40'}`}
                            >
                              {member.role === 'ADMIN' ? '取消副管' : '设为副管'}
                            </button>
                          )}
                          <button
                            onClick={() => handleChangeCreator(member)}
                            disabled={isActionLoading || isCreator || !member.userId}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors disabled:opacity-50 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-800"
                          >
                            移交群主
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {groupMembers.length === 0 && <p className="text-center text-gray-500 py-4">群内暂无成员</p>}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
