/**
 * ChatGPT Graph Navigator settings popup.
 */

import {
  ASSISTANT_STREAM_OUTPUT_MODES,
  DEFAULT_ASSISTANT_STREAM_SETTINGS,
  DEFAULT_COLLAPSE_SETTINGS,
  MESSAGE_TYPES,
  STORAGE_KEYS
} from '../shared/constants.js';
import { sendMessageToTabWithFallback } from '../shared/tab-messaging.js';

let collapseSettings = { ...DEFAULT_COLLAPSE_SETTINGS };
let assistantStreamSettings = { ...DEFAULT_ASSISTANT_STREAM_SETTINGS };
let debugLogEnabled = false;
let debugLogLevels = { verbose: true, warn: true, error: true };

function isChatGptUrl(url = '') {
  return /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i.test(url);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function loadSettings() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.COLLAPSE_SETTINGS,
    STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS,
    STORAGE_KEYS.DEBUG_LOG_ENABLED,
    STORAGE_KEYS.DEBUG_LOG_LEVELS
  ]);

  collapseSettings = {
    ...DEFAULT_COLLAPSE_SETTINGS,
    ...(result[STORAGE_KEYS.COLLAPSE_SETTINGS] || {})
  };
  assistantStreamSettings = {
    ...DEFAULT_ASSISTANT_STREAM_SETTINGS,
    ...(result[STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS] || {})
  };
  debugLogEnabled = result[STORAGE_KEYS.DEBUG_LOG_ENABLED] === true;
  debugLogLevels = {
    ...debugLogLevels,
    ...(result[STORAGE_KEYS.DEBUG_LOG_LEVELS] || {})
  };
}

async function saveCollapseSettings() {
  await chrome.storage.local.set({ [STORAGE_KEYS.COLLAPSE_SETTINGS]: collapseSettings });
}

async function saveAssistantStreamSettings() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS]: assistantStreamSettings
  });
}

function assistantStreamSettingsHtml() {
  const mode = assistantStreamSettings.mode || DEFAULT_ASSISTANT_STREAM_SETTINGS.mode;
  return `
    <div class="popup-settings-card">
      <h3>Answer grouping</h3>
      <p class="setting-help">Choose how multi-part assistant output is represented in the graph.</p>
      <label class="stream-mode-option" for="assistant-stream-final-only">
        <input type="radio" name="assistant-stream-mode" id="assistant-stream-final-only"
          value="${ASSISTANT_STREAM_OUTPUT_MODES.FINAL_ONLY}"
          ${mode === ASSISTANT_STREAM_OUTPUT_MODES.FINAL_ONLY ? 'checked' : ''}>
        <span>
          <strong>Use only the final answer</strong>
          <small>Keep the last completed answer as the graph node.</small>
        </span>
      </label>
      <label class="stream-mode-option" for="assistant-stream-merge-all">
        <input type="radio" name="assistant-stream-mode" id="assistant-stream-merge-all"
          value="${ASSISTANT_STREAM_OUTPUT_MODES.MERGE_ALL}"
          ${mode === ASSISTANT_STREAM_OUTPUT_MODES.MERGE_ALL ? 'checked' : ''}>
        <span>
          <strong>Merge all streamed parts</strong>
          <small>Keep all visible parts while storing the group as one graph node.</small>
        </span>
      </label>
    </div>
  `;
}

function collapseSettingsHtml() {
  const disabledClass = collapseSettings.enabled ? '' : 'setting-disabled';
  return `
    <div class="collapse-settings">
      <h3>Chat message collapsing</h3>
      <div class="setting-item">
        <label for="collapse-enabled">
          <input type="checkbox" id="collapse-enabled" ${collapseSettings.enabled ? 'checked' : ''}>
          Enable automatic collapsing
        </label>
      </div>
      <div class="setting-group ${disabledClass}" id="collapse-options">
        <div class="setting-item">
          <label for="collapse-threshold">Threshold</label>
          <div>
            <input type="number" id="collapse-threshold" value="${collapseSettings.threshold}" min="50" max="2000" step="50">
            <span class="unit">characters</span>
          </div>
        </div>
        <div class="setting-item">
          <label for="collapse-question">
            <input type="checkbox" id="collapse-question" ${collapseSettings.autoCollapseQuestion ? 'checked' : ''}>
            Collapse long user messages
          </label>
        </div>
        <div class="setting-item">
          <label for="collapse-answer">
            <input type="checkbox" id="collapse-answer" ${collapseSettings.autoCollapseAnswer ? 'checked' : ''}>
            Collapse long ChatGPT answers
          </label>
        </div>
      </div>
    </div>
  `;
}

function debugSettingsHtml() {
  const disabledClass = debugLogEnabled ? '' : 'setting-disabled';
  return `
    <div class="collapse-settings">
      <h3>Developer options</h3>
      <div class="setting-item">
        <label for="debug-log-enabled">
          <input type="checkbox" id="debug-log-enabled" ${debugLogEnabled ? 'checked' : ''}>
          Enable debug logging
        </label>
      </div>
      <div class="setting-group ${disabledClass}" id="debug-log-levels">
        <div class="setting-item"><label><input type="checkbox" id="debug-log-verbose" ${debugLogLevels.verbose ? 'checked' : ''}>Verbose logs</label></div>
        <div class="setting-item"><label><input type="checkbox" id="debug-log-warn" ${debugLogLevels.warn ? 'checked' : ''}>Warnings</label></div>
        <div class="setting-item"><label><input type="checkbox" id="debug-log-error" ${debugLogLevels.error ? 'checked' : ''}>Errors</label></div>
      </div>
    </div>
  `;
}

function renderAnswerGroupingPanel() {
  const panel = document.getElementById('popup-settings-panel');
  if (!panel) return;
  panel.innerHTML = assistantStreamSettingsHtml();
  panel.querySelectorAll('input[name="assistant-stream-mode"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      assistantStreamSettings = { ...assistantStreamSettings, mode: input.value };
      await saveAssistantStreamSettings();
    });
  });
}

function bindHeaderSettingsButton() {
  const button = document.getElementById('popup-settings-btn');
  const panel = document.getElementById('popup-settings-panel');
  if (!button || !panel) return;
  button.addEventListener('click', () => {
    const wasOpen = !panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', wasOpen);
    button.setAttribute('aria-expanded', String(!wasOpen));
  });
}

function bindCollapseSettingsEvents() {
  const enabled = document.getElementById('collapse-enabled');
  const threshold = document.getElementById('collapse-threshold');
  const question = document.getElementById('collapse-question');
  const answer = document.getElementById('collapse-answer');
  const options = document.getElementById('collapse-options');

  enabled?.addEventListener('change', async () => {
    collapseSettings.enabled = enabled.checked;
    options?.classList.toggle('setting-disabled', !enabled.checked);
    await saveCollapseSettings();
  });
  threshold?.addEventListener('change', async () => {
    const value = Number.parseInt(threshold.value, 10);
    if (!Number.isFinite(value) || value < 50 || value > 2000) return;
    collapseSettings.threshold = value;
    await saveCollapseSettings();
  });
  question?.addEventListener('change', async () => {
    collapseSettings.autoCollapseQuestion = question.checked;
    await saveCollapseSettings();
  });
  answer?.addEventListener('change', async () => {
    collapseSettings.autoCollapseAnswer = answer.checked;
    await saveCollapseSettings();
  });
}

function bindDebugSettingsEvents() {
  const enabled = document.getElementById('debug-log-enabled');
  const verbose = document.getElementById('debug-log-verbose');
  const warn = document.getElementById('debug-log-warn');
  const error = document.getElementById('debug-log-error');
  const levels = document.getElementById('debug-log-levels');

  enabled?.addEventListener('change', async () => {
    debugLogEnabled = enabled.checked;
    levels?.classList.toggle('setting-disabled', !debugLogEnabled);
    await chrome.storage.local.set({ [STORAGE_KEYS.DEBUG_LOG_ENABLED]: debugLogEnabled });
  });

  const saveLevels = async () => {
    debugLogLevels = {
      verbose: verbose?.checked ?? debugLogLevels.verbose,
      warn: warn?.checked ?? debugLogLevels.warn,
      error: error?.checked ?? debugLogLevels.error
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.DEBUG_LOG_LEVELS]: debugLogLevels });
  };

  verbose?.addEventListener('change', saveLevels);
  warn?.addEventListener('change', saveLevels);
  error?.addEventListener('change', saveLevels);
}

function bindCommonSettings() {
  bindCollapseSettingsEvents();
  bindDebugSettingsEvents();
}

function relativeAge(timestamp) {
  if (!timestamp) return 'unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

async function toggleDockFromPopup() {
  const tab = await getActiveTab();
  if (!tab?.id || !isChatGptUrl(tab.url)) {
    alert('Open a ChatGPT conversation first.');
    return;
  }
  await sendMessageToTabWithFallback(tab.id, { type: 'CG_TOGGLE_DOCKED_PANEL' });
  window.close();
}

async function renderStatus() {
  const container = document.getElementById('content');
  if (!container) return;

  const result = await chrome.storage.local.get([
    'accessToken',
    'tokenTimestamp',
    'tokenSource'
  ]);

  const hasToken = Boolean(result.accessToken);
  const tokenAge = result.tokenTimestamp ? Date.now() - result.tokenTimestamp : null;
  const tokenExpired = tokenAge !== null && tokenAge >= 24 * 60 * 60 * 1000;

  if (!hasToken) {
    container.innerHTML = `
      <div class="status">
        <div class="status-item"><span class="status-label">Authentication</span><span class="status-value warning">Waiting for token</span></div>
      </div>
      <div class="help"><p><strong>Automatic token capture</strong><br><br>Use ChatGPT normally. The extension captures the access token from ChatGPT requests and stores it only in this browser profile.</p></div>
      <div class="actions"><button id="setup-btn">Manual setup</button></div>
      ${collapseSettingsHtml()}
      ${debugSettingsHtml()}
    `;
    document.getElementById('setup-btn')?.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/setup/index.html') });
    });
    bindCommonSettings();
    return;
  }

  const source = result.tokenSource === 'auto' ? 'Automatic' : 'Manual';
  container.innerHTML = `
    <div class="status">
      <div class="status-item"><span class="status-label">Authentication</span><span class="status-value ${tokenExpired ? 'warning' : 'success'}">${tokenExpired ? 'Expired' : 'Ready'}</span></div>
      <div class="status-item"><span class="status-label">Source</span><span class="status-value">${source}</span></div>
    </div>
    <div class="token-info">
      <h3>Token information</h3>
      <div class="token-time">Captured ${relativeAge(result.tokenTimestamp)} · ${result.accessToken.length} characters</div>
    </div>
    <div class="actions"><button class="primary" id="toggle-dock-btn">Toggle graph panel</button></div>
    <div class="actions">
      <button id="update-btn">Manual setup</button>
      <button id="clear-btn">Clear token</button>
    </div>
    <div class="help"><p>${tokenExpired
      ? 'The stored token is expired. Using ChatGPT normally should capture a fresh token automatically.'
      : 'The extension is ready. Open a ChatGPT conversation to use the graph.'}</p></div>
    ${collapseSettingsHtml()}
    ${debugSettingsHtml()}
  `;

  bindCommonSettings();
  document.getElementById('toggle-dock-btn')?.addEventListener('click', () => {
    toggleDockFromPopup().catch((error) => {
      console.error('Failed to toggle graph panel:', error);
      alert('Failed to toggle the graph panel. Refresh ChatGPT and try again.');
    });
  });
  document.getElementById('update-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/setup/index.html') });
  });
  document.getElementById('clear-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear the stored ChatGPT access token?')) return;
    try {
      await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_TOKEN });
    } catch {
      await chrome.storage.local.remove(['accessToken', 'tokenTimestamp', 'tokenSource']);
    }
    await renderStatus();
  });
}

async function initialize() {
  await loadSettings();
  bindHeaderSettingsButton();
  renderAnswerGroupingPanel();
  await renderStatus();
}

document.addEventListener('DOMContentLoaded', () => {
  initialize().catch((error) => {
    console.error('Failed to initialize popup:', error);
    const container = document.getElementById('content');
    if (container) {
      container.innerHTML = '<div class="status"><div class="status-item"><span class="status-label">Error</span><span class="status-value error">Failed to load settings</span></div></div>';
    }
  });
});
