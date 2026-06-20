"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";

const VERSION = "1.3.10";

const releaseNotes = [
  "自动刷新调整为页面可见时每 60 秒执行，重新聚焦时立即同步。",
  "合并重复的认领状态查询，并防止刷新请求重叠。",
  "数据库查询新增集合与字段白名单、查询范围校验和单次返回上限。",
  "通用写入接口仅保留必要操作，降低越权读写风险。",
  "操作成功后立即刷新相关数据，保持页面反馈及时。"
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
