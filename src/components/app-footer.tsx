"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";

const VERSION = "1.5.1";

const releaseNotes = [
  "清理全项目 ESLint 错误和警告，恢复代码质量检查。",
  "收紧 API、Firestore 与页面数据类型，减少运行时字段错误。",
  "优化 Hook 状态同步与依赖关系，降低重复渲染和旧数据风险。",
  "部署前新增强制 lint 与类型检查，防止质量问题再次积累。"
];

export function AppFooter() {
  const [isVersionOpen, setIsVersionOpen] = useState(false);

  return (
    <>
      <footer className="py-6 text-center text-sm text-gray-500 dark:text-gray-500 space-y-2">
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
    </>
  );
}
