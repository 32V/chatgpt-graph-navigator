/**
 * Small in-memory cache used by the service worker.
 */

import { CONFIG, STORAGE_KEYS } from '../../shared/constants.js';

export class CacheManager {
  constructor() {
    this.cache = new Map();
    this.maxSize = CONFIG.MAX_CACHE_SIZE;
    this.ttl = CONFIG.CACHE_TTL;
  }

  _getCacheKey(key) {
    return `${STORAGE_KEYS.CACHE_PREFIX}${key}`;
  }

  set(key, value, ttl = this.ttl) {
    // Evict the oldest entry when the cache reaches its configured limit.
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl
    });

    console.log(`[Cache] Set: ${key}`);
  }

  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      console.log(`[Cache] Expired: ${key}`);
      return null;
    }

    console.log(`[Cache] Hit: ${key}`);
    return cached.value;
  }

  delete(key) {
    this.cache.delete(key);
    console.log(`[Cache] Deleted: ${key}`);
  }

  clear() {
    this.cache.clear();
    console.log('[Cache] Cleared all');
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys())
    };
  }
}

export const cache = new CacheManager();
