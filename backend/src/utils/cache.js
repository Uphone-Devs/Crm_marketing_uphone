/**
 * In-memory TTL cache — zero dependencies.
 * Keys expire automatically; invalidate() purges by prefix.
 */

const store = new Map(); // key -> { value, expiresAt }

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
  return entry.value;
}

function set(key, value, ttlMs = 30_000) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Remove all keys that start with prefix */
function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function clear() { store.clear(); }

function size() { return store.size; }

// Sweep expired entries every 5 min — prevents unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 300_000).unref();

module.exports = { get, set, invalidate, clear, size };
