import useSWR from "swr";

const fetcher = async (url: string, body: any) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("API Error");
  return res.json();
};

export function useQueryProxy(collection: string, where?: any[], orderBy?: any[]) {
  const body = { action: "query", collection, where, orderBy };
  const key = JSON.stringify(body);
  const { data, error, mutate } = useSWR(key, () => fetcher("/api/db", body), { refreshInterval: 5000 });
  return { docs: data?.docs || [], loading: !data && !error, error, mutate };
}

export function useDocProxy(collection: string, docId: string | null) {
  const body = { action: "get", collection, docId };
  const key = docId ? JSON.stringify(body) : null;
  const { data, error, mutate } = useSWR(key, () => fetcher("/api/db", body), { refreshInterval: 5000 });
  return { doc: data?.doc || null, loading: !data && !error, error, mutate };
}

export async function addDocProxy(collection: string, data: any) {
  return fetcher("/api/db", { action: "add", collection, data });
}

export async function updateDocProxy(collection: string, docId: string, data: any) {
  return fetcher("/api/db", { action: "update", collection, docId, data });
}

export async function deleteDocProxy(collection: string, docId: string) {
  return fetcher("/api/db", { action: "delete", collection, docId });
}
