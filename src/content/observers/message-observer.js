/**
 * Watches the mounted ChatGPT DOM for message changes.
 * The observer only emits change signals; canonical graph topology is refreshed
 * from the conversation API by the content script.
 */

import { log } from '../../shared/utils.js';
import { extractMessageFromDOM } from '../extractors/message-extractor.js';
import {
  getStableMessageId,
  getAllMessageContainers,
  findMessageContainer,
  isMessageContainer
} from '../utils/message-id-helper.js';

export class MessageObserver {
  constructor() {
    this.observer = null;
    this.callback = null;
    this.isRunning = false;
    this.processedMessages = new Set();
    this.pendingMessages = new Map();
    this.pendingIdObservers = new WeakMap();
    this.pendingIdArticles = new Set();
    this.periodicScanInterval = null;
  }

  start(callback) {
    if (this.isRunning) {
      log('warn', 'MessageObserver', 'Observer already running');
      return;
    }

    this.callback = callback;
    this.isRunning = true;

    let initCount = 0;
    getAllMessageContainers().forEach((container) => {
      const uniqueId = getStableMessageId(container);
      if (uniqueId) {
        this.processedMessages.add(uniqueId);
        initCount += 1;
      } else if (!this.pendingIdObservers.has(container)) {
        this._watchForMessageId(container);
      }
    });

    const targetNode = document.querySelector('main') || document.body;
    if (!targetNode) {
      this.isRunning = false;
      log('error', 'MessageObserver', 'Target node (main/body) not found');
      return;
    }

    this.observer = new MutationObserver(mutations => this._handleMutations(mutations));
    this.observer.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });

    this._startPeriodicScan();
    log('info', 'MessageObserver', 'Message observer started', { existingMessages: initCount });
  }

  stop() {
    this.observer?.disconnect();
    this.observer = null;
    this._stopPeriodicScan();

    this.processedMessages.clear();
    this.pendingMessages.forEach(timer => clearTimeout(timer));
    this.pendingMessages.clear();
    this._cleanupAllPendingIdObservers();

    this.isRunning = false;
  }

  _handleMutations(mutations) {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) this._checkForNewMessage(node);
      });
    }
  }

  _checkForNewMessage(node) {
    const containers = new Set();

    if (isMessageContainer(node)) containers.add(node);

    const directContainer = findMessageContainer(node);
    if (directContainer) containers.add(directContainer);

    if (node.querySelectorAll) {
      getAllMessageContainers(node).forEach(container => containers.add(container));
      node.querySelectorAll('[data-message-author-role][data-message-id]').forEach((messageNode) => {
        const container = findMessageContainer(messageNode);
        if (container) containers.add(container);
      });
    }

    containers.forEach(container => this._processNewContainer(container));
  }

  _processNewContainer(container) {
    const uniqueId = getStableMessageId(container);

    if (!uniqueId || uniqueId.startsWith('placeholder-')) {
      if (!this.pendingIdObservers.has(container)) this._watchForMessageId(container);
      return;
    }

    this._cleanupPendingIdObserver(container);
    if (this.processedMessages.has(uniqueId)) return;

    let role = container.getAttribute('data-turn');
    if (!role) {
      role = container.querySelector('[data-message-author-role]')
        ?.getAttribute('data-message-author-role');
    }

    this.processedMessages.add(uniqueId);

    if (role === 'user') {
      this._extractAndNotify(container, uniqueId);
    } else if (role === 'assistant') {
      this._waitForAssistantMessage(container, uniqueId);
    }
  }

  _watchForMessageId(container) {
    const TIMEOUT_MS = 10000;

    const observer = new MutationObserver(() => {
      const uniqueId = getStableMessageId(container);
      if (uniqueId && !uniqueId.startsWith('placeholder-')) {
        this._cleanupPendingIdObserver(container);
        this._processNewContainer(container);
      }
    });

    const timeoutId = setTimeout(() => {
      this._cleanupPendingIdObserver(container);
      log('warn', 'MessageObserver', 'Timeout waiting for message-id', {
        turnId: container.getAttribute('data-turn-id')
      });
    }, TIMEOUT_MS);

    this.pendingIdObservers.set(container, { observer, timeoutId });
    this.pendingIdArticles.add(container);

    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-message-id', 'data-turn-id']
    });
  }

  _cleanupPendingIdObserver(container) {
    const pending = this.pendingIdObservers.get(container);
    if (!pending) return;

    pending.observer.disconnect();
    clearTimeout(pending.timeoutId);
    this.pendingIdObservers.delete(container);
    this.pendingIdArticles.delete(container);
  }

  _cleanupAllPendingIdObservers() {
    for (const container of this.pendingIdArticles) {
      const pending = this.pendingIdObservers.get(container);
      if (!pending) continue;
      pending.observer.disconnect();
      clearTimeout(pending.timeoutId);
    }
    this.pendingIdArticles.clear();
  }

  _waitForAssistantMessage(container, uniqueId) {
    if (this.pendingMessages.has(uniqueId)) {
      clearTimeout(this.pendingMessages.get(uniqueId));
    }

    const checkComplete = () => {
      if (this._isMessageStreaming()) {
        const timer = setTimeout(checkComplete, 1000);
        this.pendingMessages.set(uniqueId, timer);
        return;
      }

      this.pendingMessages.delete(uniqueId);
      if (document.body.contains(container)) {
        this._extractAndNotify(container, uniqueId);
      } else {
        log('warn', 'MessageObserver', 'Message removed from DOM before completion', uniqueId);
      }
    };

    const timer = setTimeout(checkComplete, 500);
    this.pendingMessages.set(uniqueId, timer);
  }

  _isMessageStreaming() {
    return Boolean(
      document.querySelector('[data-testid="stop-button"]') ||
      document.querySelector('button[aria-label*="Stop" i]')
    );
  }

  _extractAndNotify(container, uniqueId) {
    const id = uniqueId || getStableMessageId(container);
    if (!id) {
      log('warn', 'MessageObserver', 'Cannot extract unique ID for notification');
      return;
    }

    this.processedMessages.add(id);
    const messageData = extractMessageFromDOM(container);
    if (!messageData) {
      log('warn', 'MessageObserver', 'Failed to extract message data from DOM');
      return;
    }

    messageData.id = id;
    if (!this.callback) return;

    try {
      Promise.resolve(this.callback(messageData)).catch(error => {
        log('error', 'MessageObserver', 'Callback execution error:', error);
      });
    } catch (error) {
      log('error', 'MessageObserver', 'Callback trigger error:', error);
    }
  }

  getProcessedCount() {
    return this.processedMessages.size;
  }

  isObserving() {
    return this.isRunning;
  }

  _startPeriodicScan() {
    this._stopPeriodicScan();

    this.periodicScanInterval = setInterval(() => {
      if (this._isMessageStreaming()) return;

      let newCount = 0;
      getAllMessageContainers().forEach((container) => {
        const uniqueId = getStableMessageId(container);
        if (!uniqueId || uniqueId.startsWith('placeholder-') || this.processedMessages.has(uniqueId)) {
          return;
        }
        newCount += 1;
        this._processNewContainer(container);
      });

      if (newCount > 0) {
        log('info', 'MessageObserver', `Periodic scan found ${newCount} new message(s)`);
      }
    }, 3000);
  }

  _stopPeriodicScan() {
    if (!this.periodicScanInterval) return;
    clearInterval(this.periodicScanInterval);
    this.periodicScanInterval = null;
  }

  reset() {
    this.processedMessages.clear();
    this.pendingMessages.forEach(timer => clearTimeout(timer));
    this.pendingMessages.clear();
    this._cleanupAllPendingIdObservers();
  }
}

export function createMessageObserver(callback) {
  const observer = new MessageObserver();
  try {
    observer.start(callback);
  } catch (error) {
    log('error', 'MessageObserver', 'Failed to start observer via factory:', error);
  }
  return observer;
}
