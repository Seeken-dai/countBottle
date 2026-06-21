"use client";

import { useEffect, useRef } from "react";

interface InfiniteScrollTriggerProps {
  hasMore: boolean;
  loading: boolean;
  error?: string | null;
  onLoadMore: () => void;
  endLabel?: string;
}

export function InfiniteScrollTrigger({
  hasMore,
  loading,
  error,
  onLoadMore,
  endLabel = "已加载全部记录"
}: InfiniteScrollTriggerProps) {
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = triggerRef.current;
    if (!element || !hasMore || loading || error) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadMore();
    }, { rootMargin: "120px 0px" });

    observer.observe(element);
    return () => observer.disconnect();
  }, [error, hasMore, loading, onLoadMore]);

  return (
    <div ref={triggerRef} role="status" aria-live="polite" className="flex min-h-10 items-center justify-center py-3 text-xs text-gray-400 dark:text-gray-500">
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-primary dark:border-gray-700 dark:border-t-primary" aria-hidden="true" />
          正在继续加载…
        </span>
      ) : error ? (
        <button type="button" onClick={onLoadMore} className="rounded-lg px-3 py-1.5 font-medium text-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30">
          加载失败，点击重试
        </button>
      ) : hasMore ? (
        <span>继续向下滚动</span>
      ) : (
        <span>{endLabel}</span>
      )}
    </div>
  );
}
