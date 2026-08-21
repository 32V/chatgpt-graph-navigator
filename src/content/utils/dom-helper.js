/**
 * Wait for a selector to appear in the ChatGPT document.
 */
export function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const target = document.body || document.documentElement;
    if (!target) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) finish(element);
    });
    observer.observe(target, { childList: true, subtree: true });

    const timer = setTimeout(() => finish(null), timeout);
  });
}
