import { LOG_PREFIX, STORAGE_KEYS } from './constants.js';

const DEFAULT_DEBUG_LOG_LEVELS = {
  verbose: true,
  warn: true,
  error: true
};

let debugLogEnabled = false;
let debugLogLevels = { ...DEFAULT_DEBUG_LOG_LEVELS };
let debugStorageListenerInstalled = false;

function applyDebugSettings(enabled, levels) {
  debugLogEnabled = enabled === true;
  debugLogLevels = {
    ...DEFAULT_DEBUG_LOG_LEVELS,
    ...(levels || {})
  };
}

export async function initDebugLogSetting() {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.DEBUG_LOG_ENABLED,
      STORAGE_KEYS.DEBUG_LOG_LEVELS
    ]);
    applyDebugSettings(
      result[STORAGE_KEYS.DEBUG_LOG_ENABLED],
      result[STORAGE_KEYS.DEBUG_LOG_LEVELS]
    );

    if (!debugStorageListenerInstalled && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        if (changes[STORAGE_KEYS.DEBUG_LOG_ENABLED]) {
          debugLogEnabled = changes[STORAGE_KEYS.DEBUG_LOG_ENABLED].newValue === true;
        }
        if (changes[STORAGE_KEYS.DEBUG_LOG_LEVELS]) {
          debugLogLevels = {
            ...DEFAULT_DEBUG_LOG_LEVELS,
            ...(changes[STORAGE_KEYS.DEBUG_LOG_LEVELS].newValue || {})
          };
        }
      });
      debugStorageListenerInstalled = true;
    }
  } catch {
    // Non-extension/test contexts may not expose storage.
  }
}

export function getDebugLogEnabled() {
  return debugLogEnabled;
}

export function log(level, module, ...args) {
  if (!debugLogEnabled) return;
  if (level === 'error' && !debugLogLevels.error) return;
  if (level === 'warn' && !debugLogLevels.warn) return;
  if (level !== 'error' && level !== 'warn' && !debugLogLevels.verbose) return;

  const method = typeof console[level] === 'function' ? level : 'log';
  console[method](`${LOG_PREFIX}[${module}]`, ...args);
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retry(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        log('warn', 'Utils', `Retry ${attempt}/${maxRetries} failed:`, error?.message || error);
        await delay(delayMs);
      }
    }
  }
  throw lastError;
}

export function throttle(fn, wait) {
  let lastRun = 0;
  let trailingTimer = null;
  let trailingArgs = null;
  let trailingThis = null;

  const run = () => {
    trailingTimer = null;
    lastRun = Date.now();
    const args = trailingArgs;
    const context = trailingThis;
    trailingArgs = null;
    trailingThis = null;
    return fn.apply(context, args);
  };

  return function throttled(...args) {
    const elapsed = Date.now() - lastRun;
    if (elapsed >= wait) {
      if (trailingTimer) clearTimeout(trailingTimer);
      trailingArgs = args;
      trailingThis = this;
      return run();
    }

    trailingArgs = args;
    trailingThis = this;
    if (!trailingTimer) trailingTimer = setTimeout(run, wait - elapsed);
    return undefined;
  };
}

export function extractConversationId(url = window.location.pathname) {
  const match = String(url || '').match(/\/c\/([a-f0-9-]+)/i);
  return match?.[1] || null;
}
