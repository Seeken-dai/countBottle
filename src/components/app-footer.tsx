"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";

const VERSION = "1.3.9";

const releaseNotes = [
  "计息周期改为按自然日历推进，不再用固定 30 天或 365 天近似月份和年份。",
  "每月计息保持设定日期，遇到短月份时落到月末，后续月份恢复原设定日期。",
  "每年计息正确处理闰年与 2 月 29 日。",
  "计息预览与实际懒计算使用相同规则，错过多期时仍能正确补算。"
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
