import useSWR from "swr";

export const proxyRequest = async (body: any) => {
  const res = await fetch("/api/db", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(error?.error || "API Error");
  }
  return res.json();
};

export function useQueryProxy(collection: string, where?: any[], orderBy?: any[]) {
  const body = { action: "query", collection, where, orderBy };
  const key = JSON.stringify(body);
  const { data, error, mutate } = useSWR(key, () => proxyRequest(body), { refreshInterval: 60_000, refreshWhenHidden: false, revalidateOnFocus: true });
  return { docs: data?.docs || [], loading: !data && !error, error, mutate };
}

export function useDocProxy(collection: string, docId: string | null) {
  const body = { action: "get", collection, docId };
  const key = docId ? JSON.stringify(body) : null;
  const { data, error, mutate } = useSWR(key, () => proxyRequest(body), { refreshInterval: 60_000, refreshWhenHidden: false, revalidateOnFocus: true });
  return { doc: data?.doc || null, loading: !data && !error, error, mutate };
}

export type ProxyWhereClause = [string, "==" | "in", unknown];
export type ProxyOrderBy = [string, "asc" | "desc"];

export interface QueryPage<T> {
  docs: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function queryPageProxy<T>(
  collection: string,
  where: ProxyWhereClause[],
  orderBy: ProxyOrderBy,
  limit: number,
  cursor?: string | null
): Promise<QueryPage<T>> {
  const data = await proxyRequest({ action: "queryPage", collection, where, orderBy, limit, cursor });
  return {
    docs: data.docs || [],
    nextCursor: data.nextCursor || null,
    hasMore: !!data.hasMore
  };
}

export async function queryProxy(collection: string, where?: any[], orderBy?: any[], limit?: number) {
  const data = await proxyRequest({ action: "query", collection, where, orderBy, limit });
  return data.docs || [];
}

export async function getDocProxy(collection: string, docId: string) {
  const data = await proxyRequest({ action: "get", collection, docId });
  return data.doc || null;
}

export async function addDocProxy(collection: string, data: any) {
  return proxyRequest({ action: "add", collection, data });
}

export async function updateDocProxy(collection: string, docId: string, data: any) {
  return proxyRequest({ action: "update", collection, docId, data });
}

export async function setDocProxy(collection: string, docId: string, data: any, merge = true) {
  return proxyRequest({ action: "set", collection, docId, data, merge });
}

export async function deleteDocProxy(collection: string, docId: string) {
  return proxyRequest({ action: "delete", collection, docId });
}
