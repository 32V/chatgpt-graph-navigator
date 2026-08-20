/**
 * Shared utility functions.
 */

import { LOG_PREFIX, STORAGE_KEYS } from './constants.js';

let debugLogEnabled = false;
let debugLogLevels = {
  verbose: true,
  warn: true,
  error: true
};

export async function initDebugLogSetting() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.DEBUG_LOG_ENABLED,
        STORAGE_KEYS.DEBUG_LOG_LEVELS
      ]);
      debugLogEnabled = result[STORAGE_KEYS.DEBUG_LOG_ENABLED] === true;
      if (result[STORAGE_KEYS.DEBUG_LOG_LEVELS]) {
        debugLogLevels = { ...debugLogLevels, ...result[STORAGE_KEYS.DEBUG_LOG_LEVELS] };
      }
    }
  } catch {
    // Storage is unavailable in non-extension contexts.
  }
}

export async function setDebugLogEnabled(enabled) {
  debugLogEnabled = enabled;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ [STORAGE_KEYS.DEBUG_LOG_ENABLED]: enabled });
    }
  } catch {
    // Best-effort setting persistence.
  }
}

export function getDebugLogEnabled() {
  return debugLogEnabled;
}

export async function setDebugLogLevels(levels) {
  debugLogLevels = { ...debugLogLevels, ...levels };
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ [STORAGE_KEYS.DEBUG_LOG_LEVELS]: debugLogLevels });
    }
  } catch {
    // Best-effort setting persistence.
  }
}

export function getDebugLogLevels() {
  return { ...debugLogLevels };
}

/**
 * Emit an extension log when the requested debug level is enabled.
 */
export function log(level, module, ...args) {
  if (!debugLogEnabled) return;

  if (level === 'error') {
    if (!debugLogLevels.error) return;
  } else if (level === 'warn') {
    if (!debugLogLevels.warn) return;
  } else if (!debugLogLevels.verbose) {
    return;
  }

  const prefix = `${LOG_PREFIX}[${module}]`;
  console[level](prefix, ...args);
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retry(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      log('warn', 'Utils', `Retry ${i + 1}/${maxRetries} failed:`, error.message);
      if (i < maxRetries - 1) await delay(delayMs);
    }
  }

  throw lastError;
}

export function safeJSONParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    log('error', 'Utils', 'JSON parse error:', error);
    return defaultValue;
  }
}

export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (Array.isArray(obj)) return obj.map(item => deepClone(item));

  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

export function throttle(fn, wait) {
  let lastTime = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastTime < wait) return undefined;
    lastTime = now;
    return fn.apply(this, args);
  };
}

export function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function extractConversationId(url = window.location.pathname) {
  const match = url.match(/\/c\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

export function isChatGPTPage() {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)/.test(window.location.href);
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round(bytes / Math.pow(k, index) * 100) / 100} ${sizes[index]}`;
}

export function truncate(str, maxLength = 100) {
  if (!str || str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...`;
}
