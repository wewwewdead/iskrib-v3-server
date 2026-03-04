/**
 * Simple in-memory LRU cache with TTL expiration.
 * @param {number} maxSize - Maximum number of entries
 * @param {number} ttlMs - Time-to-live in milliseconds
 */
export function createLRUCache(maxSize = 200, ttlMs = 60 * 60 * 1000) {
    const cache = new Map();

    function get(key) {
        const entry = cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.ts > ttlMs) {
            cache.delete(key);
            return null;
        }
        // LRU refresh — move to end
        cache.delete(key);
        cache.set(key, entry);
        return entry.value;
    }

    function set(key, value) {
        if (cache.size >= maxSize) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }
        cache.set(key, { value, ts: Date.now() });
    }

    function clear() {
        cache.clear();
    }

    return { get, set, clear };
}
