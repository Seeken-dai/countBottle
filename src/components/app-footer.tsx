"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";

const VERSION = "1.4.1";

const releaseNotes = [
  "群组统计新增近 7 天新增最多与核销最多人员。",
  "冠军卡片默认展示第一名，点击可查看前三名领奖台。",
  "排行榜采用按需快照查询，不进行定时轮询或实时监听。",
  "群组长图自动隐藏当前数量为 0 的成员。"
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
