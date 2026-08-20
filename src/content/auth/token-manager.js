/**
 * Content-side authentication state.
 * Supports automatically captured and manually configured bearer tokens.
 */

import { log } from '../../shared/utils.js';

let capturedToken = null;
let cachedAuthInfo = null;
let tokenSource = null;

function getCookie(name) {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split('=');
    if (cookieName === name) return decodeURIComponent(cookieValue);
  }
  return null;
}

export async function loadToken() {
  try {
    const result = await chrome.storage.local.get([
      'accessToken',
      'tokenTimestamp',
      'tokenSource'
    ]);

    if (!result.accessToken) {
      log('warn', 'Token', 'No token found in storage, waiting for auto-capture');
      return false;
    }

    const age = Date.now() - (result.tokenTimestamp || 0);
    const maxAge = 24 * 60 * 60 * 1000;

    if (age >= maxAge) {
      log('warn', 'Token', 'Stored token expired (>24h), waiting for auto-capture');
      capturedToken = null;
      tokenSource = null;
      return false;
    }

    capturedToken = result.accessToken;
    tokenSource = result.tokenSource || 'unknown';
    cachedAuthInfo = null;

    log('info', 'Token', 'Loaded token from storage', {
      source: tokenSource,
      length: capturedToken.length,
      age: `${Math.floor(age / 60000)} minutes`
    });
    return true;
  } catch (error) {
    log('error', 'Token', 'Failed to load token:', error);
    return false;
  }
}

export function initTokenListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.accessToken) return;

    const newToken = changes.accessToken.newValue;
    const newSource = changes.tokenSource?.newValue || 'auto';

    if (newToken && newToken !== capturedToken) {
      capturedToken = newToken;
      tokenSource = newSource;
      cachedAuthInfo = null;
      log('info', 'Token', 'Token updated from storage', {
        source: tokenSource,
        length: capturedToken.length
      });
      return;
    }

    if (!newToken) {
      capturedToken = null;
      tokenSource = null;
      cachedAuthInfo = null;
      log('info', 'Token', 'Token cleared from storage');
    }
  });

  log('info', 'Token', 'Token listener initialized');
}

export function getToken() {
  return capturedToken;
}

export function hasToken() {
  return Boolean(capturedToken);
}

export function getTokenSource() {
  return tokenSource;
}

function getAuthInfo() {
  if (cachedAuthInfo && Date.now() - cachedAuthInfo.timestamp < 60000) {
    return cachedAuthInfo.data;
  }

  const authInfo = {
    accessToken: capturedToken,
    accountId: getCookie('_account'),
    deviceId: getCookie('oai-did')
  };

  cachedAuthInfo = {
    data: authInfo,
    timestamp: Date.now()
  };

  log('info', 'API', 'Auth info retrieved:', {
    hasToken: Boolean(authInfo.accessToken),
    hasAccountId: Boolean(authInfo.accountId),
    hasDeviceId: Boolean(authInfo.deviceId),
    tokenSource: tokenSource || 'none'
  });

  return authInfo;
}

export function clearAuthCache() {
  cachedAuthInfo = null;
  log('info', 'API', 'Auth cache cleared');
}

export function buildAuthHeaders() {
  const authInfo = getAuthInfo();
  const headers = {
    accept: '*/*'
  };

  if (authInfo.accessToken) {
    headers.authorization = `Bearer ${authInfo.accessToken}`;
  } else {
    log('warn', 'API', 'No access token available; request may fail');
  }

  if (authInfo.accountId) headers['chatgpt-account-id'] = authInfo.accountId;
  if (authInfo.deviceId) headers['oai-device-id'] = authInfo.deviceId;
  return headers;
}

export async function getTokenStatus() {
  try {
    const result = await chrome.storage.local.get([
      'accessToken',
      'tokenTimestamp',
      'tokenSource',
      'tokenInfo'
    ]);

    if (!result.accessToken) {
      return {
        hasToken: false,
        source: null,
        isExpired: true,
        message: 'No token found'
      };
    }

    const age = Date.now() - (result.tokenTimestamp || 0);
    const isExpired = age >= 24 * 60 * 60 * 1000;

    return {
      hasToken: true,
      source: result.tokenSource || 'unknown',
      age,
      ageMinutes: Math.floor(age / 60000),
      isExpired,
      tokenLength: result.accessToken.length,
      message: isExpired ? 'Token expired' : 'Token valid'
    };
  } catch (error) {
    log('error', 'Token', 'Error getting token status:', error);
    return {
      hasToken: false,
      source: null,
      isExpired: true,
      error: error.message
    };
  }
}
