

(function() {
  'use strict';

  console.log('[ChatGPT Graph][MainWorld] Script loaded in MAIN world');

  let capturedToken = null;
  const originalFetch = window.fetch.bind(window);

  
  const interceptedFetch = function(...args) {
    const [url, options] = args;

    
    try {
      if (options && options.headers && url && url.includes('/backend-api/')) {
        const headers = options.headers;
        let authHeader = null;

        if (headers instanceof Headers) {
          authHeader = headers.get('authorization');
        } else if (typeof headers === 'object') {
          authHeader = headers['authorization'] || headers['Authorization'];
        }

        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.replace('Bearer ', '');
          if (token !== capturedToken) {
            capturedToken = token;
            console.log('[ChatGPT Graph][MainWorld] ✓ Token captured!', {
              length: token.length,
              preview: token.substring(0, 20) + '...',
              url: url.split('?')[0]
            });

            
            window.postMessage({
              type: 'CHATGPT_GRAPH_TOKEN',
              token: token,
              timestamp: Date.now()
            }, '*');
          }
        }
      }
    } catch (e) {
      console.error('[ChatGPT Graph][MainWorld] Error intercepting fetch:', e);
    }

    return originalFetch(...args);
  };

  
  try {
    Object.defineProperty(window, 'fetch', {
      value: interceptedFetch,
      writable: false,
      configurable: false
    });
    console.log('[ChatGPT Graph][MainWorld] ✓ Fetch interceptor installed (non-writable)');
  } catch (e) {
    
    console.warn('[ChatGPT Graph][MainWorld] Failed to use defineProperty, using assignment:', e.message);
    window.fetch = interceptedFetch;
    console.log('[ChatGPT Graph][MainWorld] ✓ Fetch interceptor installed (writable)');
  }

  
  console.log('[ChatGPT Graph][MainWorld] Interceptor test:', {
    fetchType: typeof window.fetch,
    fetchString: window.fetch.toString().substring(0, 100),
    isOriginal: window.fetch === originalFetch
  });
})();
