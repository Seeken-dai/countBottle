"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { getDocProxy } from "@/lib/useFirestore";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    
    if (!user) {
      router.replace("/login");
      return;
    }

    const checkAdmin = async () => {
      try {
        const admin = await getDocProxy("SuperAdmins", user.uid);
        if (admin) {
          setIsSuperAdmin(true);
        } else {
          setIsSuperAdmin(false);
          router.replace("/dashboard");
        }
      } catch (err) {
        console.error("Error checking super admin", err);
        router.replace("/dashboard");
      }
    };

    checkAdmin();
  }, [user, loading, router]);

  if (loading || isSuperAdmin === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-500 text-sm">正在验证系统管理员权限...</p>
      </div>
    );
  }

  if (isSuperAdmin === false) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-300">
      {children}
    </div>
  );
}
