/**
 * Tracks ChatGPT SPA route changes without monkey-patching the page History API.
 */

import { log, extractConversationId } from '../../shared/utils.js';

export class URLObserver {
  constructor() {
    this.currentUrl = window.location.href;
    this.currentConversationId = extractConversationId();
    this.callback = null;
    this.pollingInterval = null;
    this.isRunning = false;
    this.handlePopState = () => this._checkUrlChange(true);
  }

  start(callback, pollingIntervalMs = 1000) {
    if (this.isRunning) return;

    this.callback = callback;
    this.currentUrl = window.location.href;
    this.currentConversationId = extractConversationId();
    this.isRunning = true;

    window.addEventListener('popstate', this.handlePopState);
    this.pollingInterval = setInterval(() => this._checkUrlChange(), pollingIntervalMs);
  }

  stop() {
    if (!this.isRunning) return;
    window.removeEventListener('popstate', this.handlePopState);
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.pollingInterval = null;
    this.isRunning = false;
  }

  _checkUrlChange(force = false) {
    if (!chrome.runtime?.id) {
      this.stop();
      return;
    }

    const newUrl = window.location.href;
    if (!force && newUrl === this.currentUrl) return;
    this.currentUrl = newUrl;

    const newConversationId = extractConversationId();
    if (newConversationId === this.currentConversationId) return;

    const oldConversationId = this.currentConversationId;
    this.currentConversationId = newConversationId;

    log('info', 'URLObserver', 'Conversation route changed', {
      from: oldConversationId || '(none)',
      to: newConversationId || '(none)'
    });

    if (!this.callback) return;
    try {
      Promise.resolve(this.callback(newConversationId, oldConversationId)).catch(error => {
        log('error', 'URLObserver', 'Callback error:', error);
      });
    } catch (error) {
      log('error', 'URLObserver', 'Callback error:', error);
    }
  }
}

export function createURLObserver(callback, pollingIntervalMs = 1000) {
  const observer = new URLObserver();
  observer.start(callback, pollingIntervalMs);
  return observer;
}
