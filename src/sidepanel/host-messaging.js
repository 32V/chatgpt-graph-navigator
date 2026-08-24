const TRUSTED_HOST_ORIGINS = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com'
]);

const hostOrigin = (() => {
  try {
    const origin = new URL(document.referrer).origin;
    return TRUSTED_HOST_ORIGINS.has(origin) ? origin : '*';
  } catch {
    return '*';
  }
})();

export function postToHost(message) {
  window.parent?.postMessage(message, hostOrigin);
}

export function isTrustedHostEvent(event) {
  return event.source === window.parent && TRUSTED_HOST_ORIGINS.has(event.origin);
}
