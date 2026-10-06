import { loadConfig } from "./config.js";
import { MoodleApi } from "./moodle.js";

let api: MoodleApi | null = null;

export function getApi(): MoodleApi {
  if (!api) api = new MoodleApi(loadConfig());
  return api;
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value as T);
  return loader().then((value) => {
    store.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  });
}

export function invalidate(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
