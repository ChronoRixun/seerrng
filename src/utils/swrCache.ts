import type { Cache } from 'swr';

const SWR_CACHE_KEY = 'seerr-swr-cache-v1';
const RESPONSE_CACHE_PREFIX = 'seerr-response-cache-v1:';
const MAX_SWR_CACHE_ENTRIES = 160;
const MAX_RESPONSE_CACHE_AGE = 1000 * 60 * 60 * 24;

type CacheRecord<T> = {
  timestamp: number;
  data: T;
};

const canUseStorage = () =>
  typeof window !== 'undefined' && !!window.localStorage;

// Auth/session state must never be persisted: a stale cached user on the
// login page causes redirect loops after the server session is destroyed.
const isCacheableKey = (key: unknown): key is string =>
  typeof key === 'string' &&
  key.startsWith('/api/v1/') &&
  !key.startsWith('/api/v1/auth/');

const readJson = <T>(key: string): T | undefined => {
  if (!canUseStorage()) {
    return undefined;
  }

  try {
    const value = window.localStorage.getItem(key);

    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    window.localStorage.removeItem(key);
  }
};

const getResponseCacheKey = (key: string) =>
  `${RESPONSE_CACHE_PREFIX}${encodeURIComponent(key)}`;

export const getPersistentResponse = <T>(key: string): T | undefined => {
  const record = readJson<CacheRecord<T>>(getResponseCacheKey(key));

  if (!record) {
    return undefined;
  }

  if (Date.now() - record.timestamp > MAX_RESPONSE_CACHE_AGE) {
    window.localStorage.removeItem(getResponseCacheKey(key));
    return undefined;
  }

  return record.data;
};

export const setPersistentResponse = <T>(key: string, data: T | undefined) => {
  if (data === undefined) {
    return;
  }

  writeJson(getResponseCacheKey(key), {
    timestamp: Date.now(),
    data,
  });
};

let clearActiveCache: (() => void) | undefined;

/**
 * Wipes the persistent SWR/response caches (localStorage) and the active
 * in-memory SWR cache. Used on logout so no user-specific data survives
 * into the next session.
 */
export const clearPersistentCache = () => {
  clearActiveCache?.();

  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(SWR_CACHE_KEY);
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(RESPONSE_CACHE_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore storage failures
  }
};

export const createPersistentSWRCache = (): Cache => {
  const entries = readJson<[string, unknown][]>(SWR_CACHE_KEY) ?? [];
  const cache = new Map<string, unknown>(
    entries.filter(([key]) => isCacheableKey(key))
  );
  let persistTimer: number | undefined;

  const persist = () => {
    if (!canUseStorage()) {
      return;
    }

    if (persistTimer) {
      window.clearTimeout(persistTimer);
    }

    persistTimer = window.setTimeout(() => {
      const cacheEntries = Array.from(cache.entries())
        .filter(([key]) => isCacheableKey(key))
        .slice(-MAX_SWR_CACHE_ENTRIES);

      writeJson(SWR_CACHE_KEY, cacheEntries);
    }, 250);
  };

  const originalSet = cache.set.bind(cache);
  const originalDelete = cache.delete.bind(cache);

  cache.set = (key, value) => {
    originalSet(key, value);

    if (isCacheableKey(key)) {
      persist();
    }

    return cache;
  };

  cache.delete = (key) => {
    const deleted = originalDelete(key);

    if (isCacheableKey(key)) {
      persist();
    }

    return deleted;
  };

  clearActiveCache = () => {
    if (persistTimer !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(persistTimer);
      persistTimer = undefined;
    }

    cache.clear();
  };

  return cache as Cache;
};
