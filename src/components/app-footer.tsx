"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";

const VERSION = "1.3.8";

const releaseNotes = [
  "群主可在群组设置中维护计息起算时间，用于控制下一次自动计息的统一基准。",
  "新增固定数量计息方式，可按周期为所有正余额成员增加固定数量。",
  "计息预览补充预计触发日期，便于确认后续结息节奏。",
  "自动结息会同步写入群组操作日志，便于查看全群结息情况。",
  "群主和子管理员在有待审核认领申请时，会在群组详情页设置入口看到轻提示。",
  "成员个人流水新增操作人信息，便于查看余额变化来源。",
  "版本更新弹窗调整为仅展示当前版本内容。"
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
