export const VISIBLE_REFRESH_INTERVAL_MS = 60_000;

export function startVisibleRefresh(
  task: () => Promise<unknown> | unknown,
  intervalMs = VISIBLE_REFRESH_INTERVAL_MS
) {
  let active = true;
  let running = false;

  const run = async (force = false) => {
    if (!active || running) return;
    if (!force && document.visibilityState !== "visible") return;
    running = true;
    try {
      await task();
    } catch (error) {
      console.error("Visible refresh failed", error);
    } finally {
      running = false;
    }
  };

  const handleFocus = () => { void run(); };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") void run();
  };
  const interval = window.setInterval(() => { void run(); }, intervalMs);

  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  void run(true);

  return () => {
    active = false;
    window.clearInterval(interval);
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
