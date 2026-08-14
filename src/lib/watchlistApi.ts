import type { WatchlistStateDTO, CustomListDTO, Bucket, AddWatchlistItemBody } from "../../shared/types/watchlist";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function fetchWatchlistState(): Promise<WatchlistStateDTO> {
  return req("/api/watchlist");
}

export function addWatchlistItem(body: AddWatchlistItemBody) {
  return req("/api/watchlist", { method: "POST", body: JSON.stringify(body) });
}

export function moveWatchlistItem(dbId: number, bucket: Bucket, listId?: number | null) {
  return req(`/api/watchlist/${dbId}`, { method: "PATCH", body: JSON.stringify({ bucket, listId }) });
}

export function removeWatchlistItem(dbId: number) {
  return req(`/api/watchlist/${dbId}`, { method: "DELETE" });
}

export function reorderBucket(bucket: Bucket, listId: number | null, orderedIds: number[]) {
  return req("/api/watchlist/reorder", { method: "POST", body: JSON.stringify({ bucket, listId, orderedIds }) });
}

export function fetchCustomLists(): Promise<CustomListDTO[]> {
  return req("/api/watchlist/lists");
}

export function createCustomList(name: string): Promise<CustomListDTO> {
  return req("/api/watchlist/lists", { method: "POST", body: JSON.stringify({ name }) });
}

export function renameCustomList(id: number, name: string): Promise<CustomListDTO> {
  return req(`/api/watchlist/lists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteCustomList(id: number) {
  return req(`/api/watchlist/lists/${id}`, { method: "DELETE" });
}
