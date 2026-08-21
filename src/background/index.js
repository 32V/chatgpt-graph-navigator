/**
 * MV3 service-worker entry point.
 */

import { setupMessageListener } from './messaging/message-handler.js';
import { db } from './database/db.js';
import { initTokenCapture, getTokenStatus } from './auth/token-capture.js';

let listenersRegistered = false;
let actionConfigured = false;
let servicesInitialized = false;
let initializePromise = null;

const CHATGPT_URL = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i;

async function updateActionForTab(tab) {
  if (!tab?.id) return;
  try {
    if (CHATGPT_URL.test(tab.url || '')) await chrome.action.enable(tab.id);
    else await chrome.action.disable(tab.id);
  } catch {
    // The tab may have disappeared while the service worker was waking.
  }
}

function setupAction() {
  chrome.action.disable();

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') void updateActionForTab(tab);
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      await updateActionForTab(await chrome.tabs.get(tabId));
    } catch {
      // Ignore short-lived tab races.
    }
  });

  chrome.tabs.query({})
    .then(tabs => Promise.all(tabs.map(updateActionForTab)))
    .catch(() => {});
}

function registerRuntimeListeners() {
  if (!listenersRegistered) {
    setupMessageListener();
    listenersRegistered = true;
  }

  if (!actionConfigured) {
    setupAction();
    actionConfigured = true;
  }
}

async function initializeServices() {
  if (servicesInitialized) return;
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    try {
      await db.open();
      const tokenCaptureReady = initTokenCapture();
      if (tokenCaptureReady) await getTokenStatus();
      servicesInitialized = true;
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

chrome.runtime.onInstalled.addListener(bootstrapBackground);
self.addEventListener('activate', (event) => {
  registerRuntimeListeners();
  event.waitUntil(initializeServices());
});

bootstrapBackground();
