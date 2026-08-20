/**
 * Small DOM helpers used by the content script.
 */

import { log } from '../../shared/utils.js';

const TURN_SELECTOR = 'section[data-turn-id], article';

/**
 * Wait for a selector to appear.
 *
 * @param {string} selector
 * @param {number} timeout
 * @returns {Promise<Element|null>}
 */
export function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver((_mutations, instance) => {
      const element = document.querySelector(selector);
      if (!element) return;
      instance.disconnect();
      resolve(element);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

export function isConversationPage() {
  return /\/c\/[a-f0-9-]+/.test(window.location.pathname);
}

export function getAllMessageElements() {
  return Array.from(document.querySelectorAll(TURN_SELECTOR));
}

/**
 * Parse visible turn content without depending on localized UI strings.
 * This helper is intentionally best-effort; canonical conversation semantics
 * come from the backend mapping, not from DOM parsing.
 */
export function parseMessageElement(turn) {
  try {
    const message = turn.querySelector('[data-message-author-role]');
    const role = message?.getAttribute('data-message-author-role');
    if (role !== 'user' && role !== 'assistant') return null;

    const contentRoot = message || turn;
    const content = Array.from(contentRoot.querySelectorAll('p, [class*="markdown"]'))
      .filter(element => !element.closest('button'))
      .map(element => element.textContent)
      .join('\n')
      .trim();

    return {
      role,
      content,
      branchInfo: parseBranchSwitcher(turn),
      element: turn
    };
  } catch (error) {
    log('error', 'DOMHelper', 'Failed to parse message element:', error);
    return null;
  }
}

function parseBranchSwitcher(turn) {
  try {
    const candidates = Array.from(turn.querySelectorAll('span, div'));
    for (const element of candidates) {
      const text = element.textContent?.trim() || '';
      const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (!match) continue;
      return {
        current: Number.parseInt(match[1], 10),
        total: Number.parseInt(match[2], 10)
      };
    }
  } catch {
    // Best-effort helper only.
  }
  return null;
}

export function markElement(element, id) {
  element.setAttribute('data-graph-id', id);
}

export function getElementMark(element) {
  return element.getAttribute('data-graph-id');
}

export function highlightElement(element, duration = 2000) {
  const originalBg = element.style.backgroundColor;
  const originalTransition = element.style.transition;

  element.style.transition = 'background-color 0.3s';
  element.style.backgroundColor = '#ffeb3b33';

  setTimeout(() => {
    element.style.backgroundColor = originalBg;
    setTimeout(() => {
      element.style.transition = originalTransition;
    }, 300);
  }, duration);
}

export function scrollToElement(element, smooth = true) {
  element.scrollIntoView({
    behavior: smooth ? 'smooth' : 'auto',
    block: 'center'
  });
}
