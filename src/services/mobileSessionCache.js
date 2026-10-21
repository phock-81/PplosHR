// Memory-only, employee-scoped, bounded TTL data cache.
// Intentionally never uses localStorage, IndexedDB or Service Worker for confidential HR/payroll data.
const cached = new Map();
const pending = new Map();
const LIMIT = 24;
let sessionGeneration = 0;
export function clearMobileSessionCache() { sessionGeneration++; cached.clear(); pending.clear(); }
export async function getMobileCached(identity, resource, loader, ttlMs = 60000) {
  if (!identity || typeof loader !== 'function') throw Error('Authenticated user required.');
  const key = `${String(identity)}::${String(resource)}`;
  const item = cached.get(key);
  if (item && Date.now() < item.expiresAt) return item.value;
  if (pending.has(key)) return pending.get(key);
  const generation = sessionGeneration;
  const job = Promise.resolve().then(loader).then(value => {
    if (generation !== sessionGeneration) return value;
    cached.set(key, { value, expiresAt: Date.now() + Math.min(Math.max(ttlMs, 1000), 300000) });
    if (cached.size > LIMIT) cached.delete(cached.keys().next().value);
    return value;
  }).finally(() => { if (pending.get(key) === job) pending.delete(key); });
  pending.set(key, job);
  return job;
}
