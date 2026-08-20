/**
 * Service worker entrypoint.
 * Keep message receivers available immediately, then initialize slower services.
 */

import { setupMessageListener } from './messaging/message-handler.js';
import { db } from './database/db.js';
import { cache } from './cache/cache-manager.js';
import { initTokenCapture, getTokenStatus } from './auth/token-capture.js';

let listenersRegistered = false;
let actionConfigured = false;
let servicesInitialized = false;
let initializePromise = null;

const CHATGPT_CONVERSATION_URL = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/c\/[0-9a-f-]+/i;

function isConversationTab(tab) {
  return Boolean(tab?.id && CHATGPT_CONVERSATION_URL.test(tab.url || ''));
}

async function updateActionForTab(tab) {
  if (!tab?.id) return;
  try {
    if (isConversationTab(tab)) await chrome.action.enable(tab.id);
    else await chrome.action.disable(tab.id);
  } catch {
    // Tab may have disappeared while the service worker was waking.
  }
}

function setupAction() {
  // The graph is an in-page dock now. Keep the browser action disabled outside
  // ChatGPT conversations and disable the legacy browser side panel globally.
  chrome.action.disable();
  try { chrome.sidePanel?.setOptions?.({ enabled: false }); } catch {}

  chrome.action.onClicked.addListener(async (tab) => {
    if (!isConversationTab(tab)) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'CG_TOGGLE_DOCKED_PANEL' });
    } catch (error) {
      console.warn('[Background] Could not toggle docked panel:', error?.message || error);
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') void updateActionForTab(tab);
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      await updateActionForTab(tab);
    } catch {
      // ignore
    }
  });

  chrome.tabs.query({}).then(tabs => Promise.all(tabs.map(updateActionForTab))).catch(() => {});
}

function registerRuntimeListeners() {
  if (!listenersRegistered) {
    setupMessageListener();
    listenersRegistered = true;
    console.log('[Background] Message listener registered');
  }

  if (!actionConfigured) {
    setupAction();
    actionConfigured = true;
    console.log('[Background] ChatGPT-only toolbar action configured');
  }
}

async function initializeServices() {
  if (servicesInitialized) return;
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    console.log('[Background] Service Worker initializing...');

    try {
      await db.open();
      console.log('[Background] Database opened');

      const tokenCaptureReady = initTokenCapture();
      if (tokenCaptureReady) {
        const tokenStatus = await getTokenStatus();
        if (tokenStatus.hasToken && !tokenStatus.isExpired) {
          console.log('[Background] Valid token found (source:', tokenStatus.source, ')');
        } else if (tokenStatus.hasToken && tokenStatus.isExpired) {
          console.log('[Background] Token expired, waiting for auto-capture');
        } else {
          console.log('[Background] No token found, waiting for auto-capture');
        }
      } else {
        console.warn('[Background] Token auto-capture not available');
      }

      servicesInitialized = true;
      console.log('[Background] Service Worker initialized successfully');
      console.log('[Background] Cache stats:', cache.getStats());
    } catch (error) {
      console.error('[Background] Initialization failed:', error);
    } finally {
      initializePromise = null;
    }
  })();

  return initializePromise;
}

function bootstrapBackground() {
  registerRuntimeListeners();
  void initializeServices();
}

chrome.runtime.onInstalled.addListener(() => bootstrapBackground());
self.addEventListener('activate', (event) => {
  registerRuntimeListeners();
  event.waitUntil(initializeServices());
});

bootstrapBackground();
