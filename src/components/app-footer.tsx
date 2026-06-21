"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";

const VERSION = "1.3.11";

const releaseNotes = [
  "成员记账流水改为每批 30 条，滚动到底部自动加载后续记录。",
  "群组管理日志改为每批 50 条，并按筛选条件在服务端分页查询。",
  "流水与日志使用 Firestore 游标续页，避免重复读取已经展示的数据。",
  "累计数量直接使用成员汇总字段，不再扫描全部历史流水。",
  "补充加载中、失败重试和全部加载完成状态。"
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
