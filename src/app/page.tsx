"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Modal } from "@/components/ui/modal";

const VERSION = "1.3.0";

const releaseNotes = [
  "首页新增版本入口，可查看当前版本更新内容。",
  "群组设置新增操作日志，支持按人员、余额、认领和设置类型筛选。",
  "群组支持开启成员认领审核，管理员或子管理员审核通过后认领生效。",
  "成员余额调整支持填写备注，并在流水记录中展示。",
  "普通成员不再显示快捷 +1，仅保留查看能力。",
  "群组成员排序支持按账号记忆，并优化中文名称排序。",
  "超管后台群组列表新增创建人信息。"
];

export default function Home() {
  const [isVersionOpen, setIsVersionOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black flex flex-col relative overflow-hidden transition-colors duration-300">
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-primary/20 dark:bg-primary/10 rounded-full blur-3xl mix-blend-multiply dark:mix-blend-screen" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[60%] h-[60%] bg-blue-500/20 dark:bg-blue-500/10 rounded-full blur-3xl mix-blend-multiply dark:mix-blend-screen" />

      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center z-10">
        <div className="inline-block mb-4 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20">
          <span className="text-sm font-semibold text-primary">小聚记账 Web 版 Beta</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-black text-gray-900 dark:text-white tracking-tight mb-6">
          让每一次相聚<br className="hidden md:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">
            都有迹可循
          </span>
        </h1>

        <p className="text-lg md:text-xl text-gray-600 dark:text-gray-400 max-w-2xl mb-10">
          专为熟人聚会、桌游娱乐等线下场景打造的极简记账工具。轻松记录物品数量、积分或欠数，再也不用担心算不清账。
        </p>

        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md justify-center">
          <Link
            href="/register"
            className="w-full sm:w-auto px-8 py-4 rounded-2xl text-base font-bold text-white bg-primary hover:bg-primary/90 focus:ring-4 focus:ring-primary/20 transition-all shadow-xl shadow-primary/30"
          >
            免费开始使用
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto px-8 py-4 rounded-2xl text-base font-bold text-gray-900 dark:text-white bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-800 transition-all shadow-sm"
          >
            登录账号
          </Link>
        </div>
      </main>

      <footer className="py-6 text-center text-sm text-gray-500 dark:text-gray-500 z-10 space-y-2">
        <button
          type="button"
          onClick={() => setIsVersionOpen(true)}
          className="font-medium hover:text-primary transition-colors"
        >
          当前版本 V{VERSION}
        </button>
        <p>© {new Date().getFullYear()} 小聚记账. All rights reserved.</p>
      </footer>

      <Modal isOpen={isVersionOpen} onClose={() => setIsVersionOpen(false)} title={`V${VERSION} 更新内容`} maxWidth="lg">
        <ul className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          {releaseNotes.map(note => (
            <li key={note} className="flex gap-2 leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
