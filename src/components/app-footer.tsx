"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";

const VERSION = "1.3.3";

const releaseNotes = [
  "优化群组操作日志展示，改为更适合日常使用场景阅读的动态流。",
  "群组日志支持中文业务标签、备注展示和详情展开，便于查看关键操作记录。",
  "优化成员昵称保存反馈，保存后会即时提示并刷新页面显示。",
  "首页新增版本入口，可查看当前版本更新内容。",
  "群组设置新增操作日志，支持按人员、余额、认领和设置类型筛选。",
  "群组支持开启成员认领审核，管理员或子管理员审核通过后认领生效。",
  "成员余额调整支持填写备注，并在流水记录中展示。",
  "普通成员不再显示快捷 +1，仅保留查看能力。",
  "群组成员排序支持按账号记忆，并优化中文名称排序。",
  "超管后台群组列表新增创建人信息。",
  "优化群组设置页的数据加载方式，改善部分群组进入设置页时持续加载的问题。",
  "优化 Dashboard 版本与版权信息的展示位置。"
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
