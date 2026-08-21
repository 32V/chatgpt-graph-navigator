/**
 * Capture ChatGPT bearer tokens from authenticated API requests.
 */

const TARGET_URLS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*'
];

let latestToken = '';

export function initTokenCapture() {
  try {
    if (!chrome.webRequest?.onSendHeaders) return false;

    chrome.webRequest.onSendHeaders.addListener(
      onSendHeaders,
      { urls: TARGET_URLS, types: ['xmlhttprequest'] },
      ['requestHeaders', 'extraHeaders']
    );
    return true;
  } catch (error) {
    console.error('[TokenCapture] Failed to initialize:', error);
    return false;
  }
}

function onSendHeaders(details) {
  for (const header of details.requestHeaders || []) {
    if (header.name.toLowerCase() !== 'authorization') continue;

    const value = header.value || '';
    if (!value.startsWith('Bearer ')) continue;

    const accessToken = value.slice(7);
    if (!accessToken.startsWith('eyJ') || accessToken === latestToken) return;

    latestToken = accessToken;
    void chrome.storage.local.set({
      accessToken,
      tokenTimestamp: Date.now(),
      tokenSource: 'auto'
    }).catch(error => {
      console.error('[TokenCapture] Failed to persist token:', error);
    });
    return;
  }
}

export async function clearToken() {
  try {
    await chrome.storage.local.remove([
      'accessToken',
      'tokenTimestamp',
      'tokenSource'
    ]);
    latestToken = '';
    return true;
  } catch (error) {
    console.error('[TokenCapture] Failed to clear token:', error);
    return false;
  }
}
