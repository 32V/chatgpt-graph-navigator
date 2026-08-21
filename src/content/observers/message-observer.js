/**
 * Watches mounted ChatGPT turns for message-ID changes.
 *
 * This observer deliberately does not infer graph ancestry or extract message
 * content. It only reports `{ id, role }` so the content script can refresh the
 * canonical backend mapping. Tracking the last ID per DOM container also makes
 * native edited-message branch switches observable, including switches back to
 * an already visited sibling.
 */

import { log } from '../../shared/utils.js';
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
    this.lastIdByContainer = new WeakMap();
    this.pendingAssistantTimers = new Map();
    this.periodicScanInterval = null;
  }

  start(callback) {
    if (this.isRunning) return;

    const targetNode = document.querySelector('main') || document.body;
    if (!targetNode) {
      log('error', 'MessageObserver', 'Target node (main/body) not found');
      return;
    }

    this.callback = callback;
    this.isRunning = true;
    this._seedMountedContainers();

    this.observer = new MutationObserver(mutations => this._handleMutations(mutations));
    this.observer.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-message-id', 'data-turn-id']
    });

    this._startPeriodicScan();
  }

  stop() {
    this.observer?.disconnect();
    this.observer = null;
    this._stopPeriodicScan();
    this._clearPendingAssistantTimers();
    this.lastIdByContainer = new WeakMap();
    this.callback = null;
    this.isRunning = false;
  }

  reset() {
    this._clearPendingAssistantTimers();
    this.lastIdByContainer = new WeakMap();
    this._seedMountedContainers();
  }

  _seedMountedContainers() {
    getAllMessageContainers().forEach((container) => {
      const id = getStableMessageId(container);
      if (id && !id.startsWith('placeholder-')) {
        this.lastIdByContainer.set(container, id);
      }
    });
  }

  _handleMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const container = findMessageContainer(mutation.target);
        if (container) this._processContainer(container);
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) this._processNode(node);
      }
    }
  }

  _processNode(node) {
    const containers = new Set();
    if (isMessageContainer(node)) containers.add(node);

    const containingTurn = findMessageContainer(node);
    if (containingTurn) containers.add(containingTurn);

    if (node.querySelectorAll) {
      getAllMessageContainers(node).forEach(container => containers.add(container));
    }

    containers.forEach(container => this._processContainer(container));
  }

  _processContainer(container) {
    const id = getStableMessageId(container);
    if (!id || id.startsWith('placeholder-')) return;

    const previousId = this.lastIdByContainer.get(container);
    if (previousId === id) return;
    this.lastIdByContainer.set(container, id);

    const role = this._getRole(container);
    if (role !== 'user' && role !== 'assistant') return;

    if (role === 'assistant' && this._isMessageStreaming()) {
      this._waitForAssistantCompletion(container, id);
      return;
    }

    this._notify({ id, role });
  }

  _getRole(container) {
    const direct = container.getAttribute('data-turn');
    if (direct === 'user' || direct === 'assistant') return direct;
    return container.querySelector('[data-message-author-role]')
      ?.getAttribute('data-message-author-role') || null;
  }

  _waitForAssistantCompletion(container, id) {
    const existing = this.pendingAssistantTimers.get(container);
    if (existing) clearTimeout(existing.timer);

    const check = () => {
      const currentId = getStableMessageId(container);
      if (!document.body.contains(container) || currentId !== id) {
        this.pendingAssistantTimers.delete(container);
        if (document.body.contains(container)) this._processContainer(container);
        return;
      }

      if (this._isMessageStreaming()) {
        const timer = setTimeout(check, 750);
        this.pendingAssistantTimers.set(container, { id, timer });
        return;
      }

      this.pendingAssistantTimers.delete(container);
      this._notify({ id, role: 'assistant' });
    };

    const timer = setTimeout(check, 350);
    this.pendingAssistantTimers.set(container, { id, timer });
  }

  _isMessageStreaming() {
    return Boolean(
      document.querySelector('[data-testid="stop-button"]') ||
      document.querySelector('button[aria-label*="Stop" i]')
    );
  }

  _notify(signal) {
    if (!this.callback) return;
    try {
      Promise.resolve(this.callback(signal)).catch(error => {
        log('error', 'MessageObserver', 'Callback error:', error);
      });
    } catch (error) {
      log('error', 'MessageObserver', 'Callback error:', error);
    }
  }

  _startPeriodicScan() {
    this._stopPeriodicScan();
    this.periodicScanInterval = setInterval(() => {
      getAllMessageContainers().forEach(container => this._processContainer(container));
    }, 3000);
  }

  _stopPeriodicScan() {
    if (!this.periodicScanInterval) return;
    clearInterval(this.periodicScanInterval);
    this.periodicScanInterval = null;
  }

  _clearPendingAssistantTimers() {
    for (const { timer } of this.pendingAssistantTimers.values()) clearTimeout(timer);
    this.pendingAssistantTimers.clear();
  }
}

export function createMessageObserver(callback) {
  const observer = new MessageObserver();
  observer.start(callback);
  return observer;
}
