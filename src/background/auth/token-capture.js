/**
 * Capture ChatGPT bearer tokens from outgoing requests.
 */

let latestTokenInfo = {
  value: '',
  timestamp: 0,
  url: '',
  source: 'auto'
};

const TARGET_URLS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*'
];

export function initTokenCapture() {
  try {
    if (!chrome.webRequest || !chrome.webRequest.onSendHeaders) {
      console.warn('[TokenCapture] webRequest API not available');
      return false;
    }

    chrome.webRequest.onSendHeaders.addListener(
      onSendHeadersHandler,
      { urls: TARGET_URLS },
      ['requestHeaders', 'extraHeaders']
    );

    console.log('[TokenCapture] ✓ WebRequest listener initialized');
    console.log('[TokenCapture] Monitoring URLs:', TARGET_URLS);
    return true;
  } catch (error) {
    console.error('[TokenCapture] Failed to initialize listener:', error);
    return false;
  }
}

function onSendHeadersHandler(details) {
  if (!details.requestHeaders) return;

  // Only inspect top-level navigation and XHR/fetch traffic.
  if (details.type !== 'main_frame' && details.type !== 'xmlhttprequest') return;

  for (const header of details.requestHeaders) {
    if (header.name.toLowerCase() !== 'authorization') continue;

    const token = header.value;
    if (!token || !token.startsWith('Bearer ')) continue;

    const accessToken = token.substring(7);
    if (!accessToken.startsWith('eyJ')) continue;
    if (accessToken === latestTokenInfo.value) return;

    latestTokenInfo = {
      value: accessToken,
      timestamp: Date.now(),
      url: details.url,
      source: 'auto'
    };

    void saveTokenToStorage(accessToken, details.url);
    return;
  }
}

async function saveTokenToStorage(accessToken, sourceUrl) {
  try {
    await chrome.storage.local.set({
      accessToken,
      tokenTimestamp: Date.now(),
      tokenSource: 'auto',
      tokenInfo: {
        value: accessToken,
        timestamp: Date.now(),
        url: sourceUrl,
        source: 'auto'
      }
    });

    console.log('[TokenCapture] ✓ Token auto-captured and saved', {
      url: `${sourceUrl.substring(0, 60)}...`,
      tokenLength: accessToken.length,
      tokenPreview: `${accessToken.substring(0, 20)}...`
    });

    try {
      chrome.runtime.sendMessage({
        type: 'TOKEN_UPDATED',
        payload: {
          source: 'auto',
          timestamp: Date.now()
        }
      }).catch(() => {});
    } catch {
      // No listener may be active yet.
    }
  } catch (error) {
    console.error('[TokenCapture] Failed to save token:', error);
  }
}

export function getLatestTokenInfo() {
  return { ...latestTokenInfo };
}

export async function hasValidToken() {
  try {
    const result = await chrome.storage.local.get(['accessToken', 'tokenTimestamp']);
    if (!result.accessToken) return false;

    const age = Date.now() - (result.tokenTimestamp || 0);
    return age < 24 * 60 * 60 * 1000;
  } catch (error) {
    console.error('[TokenCapture] Error checking token validity:', error);
    return false;
  }
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
        age: null,
        isExpired: true
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
      captureUrl: result.tokenInfo?.url || null
    };
  } catch (error) {
    console.error('[TokenCapture] Error getting token status:', error);
    return {
      hasToken: false,
      source: null,
      age: null,
      isExpired: true,
      error: error.message
    };
  }
}

export async function clearToken() {
  try {
    await chrome.storage.local.remove([
      'accessToken',
      'tokenTimestamp',
      'tokenSource',
      'tokenInfo'
    ]);
    latestTokenInfo = {
      value: '',
      timestamp: 0,
      url: '',
      source: 'auto'
    };
    console.log('[TokenCapture] Token cleared');
    return true;
  } catch (error) {
    console.error('[TokenCapture] Failed to clear token:', error);
    return false;
  }
}
