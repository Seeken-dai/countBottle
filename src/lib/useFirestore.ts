import useSWR from "swr";

type ProxyResponse = Record<string, unknown>;

export const proxyRequest = async <T = ProxyResponse>(body: Record<string, unknown>): Promise<T> => {
  const res = await fetch("/api/db", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error: unknown = await res.json().catch(() => null);
    const message = error && typeof error === "object" && "error" in error && typeof error.error === "string"
      ? error.error
      : "API Error";
    throw new Error(message);
  }
  return res.json() as Promise<T>;
};

export function useQueryProxy<T = ProxyResponse>(collection: string, where?: ProxyWhereClause[], orderBy?: ProxyOrderBy) {
  const body = { action: "query", collection, where, orderBy };
  const key = JSON.stringify(body);
  const { data, error, mutate } = useSWR<{ docs?: T[] }>(key, () => proxyRequest(body), { refreshInterval: 60_000, refreshWhenHidden: false, revalidateOnFocus: true });
  return { docs: data?.docs || [], loading: !data && !error, error, mutate };
}

export function useDocProxy<T = ProxyResponse>(collection: string, docId: string | null) {
  const body = { action: "get", collection, docId };
  const key = docId ? JSON.stringify(body) : null;
  const { data, error, mutate } = useSWR<{ doc?: T | null }>(key, () => proxyRequest(body), { refreshInterval: 60_000, refreshWhenHidden: false, revalidateOnFocus: true });
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
  const data = await proxyRequest<{ docs?: T[]; nextCursor?: string | null; hasMore?: boolean }>({ action: "queryPage", collection, where, orderBy, limit, cursor });
  return {
    docs: data.docs || [],
    nextCursor: data.nextCursor || null,
    hasMore: !!data.hasMore
  };
}

export async function queryProxy<T = ProxyResponse>(collection: string, where?: ProxyWhereClause[], orderBy?: ProxyOrderBy, limit?: number) {
  const data = await proxyRequest<{ docs?: T[] }>({ action: "query", collection, where, orderBy, limit });
  return data.docs || [];
}

export async function getDocProxy<T = ProxyResponse>(collection: string, docId: string) {
  const data = await proxyRequest<{ doc?: T | null }>({ action: "get", collection, docId });
  return data.doc || null;
}

export async function addDocProxy(collection: string, data: object) {
  return proxyRequest({ action: "add", collection, data });
}

export async function updateDocProxy(collection: string, docId: string, data: object) {
  return proxyRequest({ action: "update", collection, docId, data });
}

export async function setDocProxy(collection: string, docId: string, data: object, merge = true) {
  return proxyRequest({ action: "set", collection, docId, data, merge });
}

export async function deleteDocProxy(collection: string, docId: string) {
  return proxyRequest({ action: "delete", collection, docId });
}
