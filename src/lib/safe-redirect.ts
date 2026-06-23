export function getSafeAppRedirect(value: string | null | undefined, fallback = "/dashboard") {
  if (!value) return fallback;
  try {
    const baseUrl = "https://countbottle.local";
    const target = new URL(value, baseUrl);
    if (target.origin !== baseUrl || !target.pathname.startsWith("/")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
