"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";

const VERSION = "1.5.3";

const releaseNotes = [
  "“新增”统一改为“记入”，更明确地表示记录新的待结数量。",
  "“核销”统一改为“结算”，减少不易理解的专业用语。",
  "“欠款”调整为“待结”，“抵扣额度”调整为“可抵扣数量”。",
  "操作页新增简短说明，帮助理解记入、结算和可抵扣数量之间的关系。"
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
