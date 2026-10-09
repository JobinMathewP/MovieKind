export type TtlCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
};

export function createTtlCache<T>(options: {
  ttlMs: number;
  max: number;
  now?: () => number;
}): TtlCache<T> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, { value, expiresAt: now() + options.ttlMs });
      while (entries.size > options.max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}
