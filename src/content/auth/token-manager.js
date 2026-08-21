/**
 * Content-side authentication state for canonical ChatGPT API requests.
 */

import { log } from '../../shared/utils.js';

const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let accessToken = null;

function getCookie(name) {
  for (const rawCookie of document.cookie.split(';')) {
    const cookie = rawCookie.trim();
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator) !== name) continue;
    return decodeURIComponent(cookie.slice(separator + 1));
  }
  return null;
}

export async function loadToken() {
  try {
    const result = await chrome.storage.local.get(['accessToken', 'tokenTimestamp']);
    const age = Date.now() - (result.tokenTimestamp || 0);

    if (!result.accessToken || age >= TOKEN_MAX_AGE_MS) {
      accessToken = null;
      return false;
    }

    accessToken = result.accessToken;
    return true;
  } catch (error) {
    accessToken = null;
    log('error', 'Token', 'Failed to load token:', error);
    return false;
  }
}

export function initTokenListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.accessToken) return;
    accessToken = changes.accessToken.newValue || null;
  });
}

export function hasToken() {
  return Boolean(accessToken);
}

export function buildAuthHeaders() {
  const headers = { accept: '*/*' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const accountId = getCookie('_account');
  const deviceId = getCookie('oai-did');
  if (accountId) headers['chatgpt-account-id'] = accountId;
  if (deviceId) headers['oai-device-id'] = deviceId;
  return headers;
}
