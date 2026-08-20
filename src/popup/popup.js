/**
 * ChatGPT Graph Navigator settings popup.
 */

import { initI18n, i18n } from '../shared/i18n.js';
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
let sidepanelUiZoom = 1;
let debugLogEnabled = false;
let debugLogLevels = {
  verbose: true,
  warn: true,
  error: true
};

const SIDEPANEL_ZOOM_MIN = 60;
const SIDEPANEL_ZOOM_MAX = 140;
const SIDEPANEL_ZOOM_STEP = 5;

function isChatGptUrl(url = '') {
  return url.includes('chatgpt.com') || url.includes('chat.openai.com');
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function loadCollapseSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.COLLAPSE_SETTINGS);
    collapseSettings = {
      ...DEFAULT_COLLAPSE_SETTINGS,
      ...(result[STORAGE_KEYS.COLLAPSE_SETTINGS] || {})
    };
  } catch (error) {
    console.warn('Failed to load collapse settings:', error);
  }
}

async function saveCollapseSettings() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.COLLAPSE_SETTINGS]: collapseSettings
  });

  const tab = await getActiveTab();
  if (!tab?.id || !isChatGptUrl(tab.url)) return;

  try {
    await sendMessageToTabWithFallback(tab.id, { type: 'COLLAPSE_SETTINGS_CHANGED' });
  } catch {
    // The next ChatGPT page load will pick up the stored value.
  }
}

async function loadAssistantStreamSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS);
    assistantStreamSettings = {
      ...DEFAULT_ASSISTANT_STREAM_SETTINGS,
      ...(result[STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS] || {})
    };
  } catch (error) {
    console.warn('Failed to load assistant stream settings:', error);
    assistantStreamSettings = { ...DEFAULT_ASSISTANT_STREAM_SETTINGS };
  }
}

async function saveAssistantStreamSettings() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS]: assistantStreamSettings
  });

  const tab = await getActiveTab();
  if (!tab?.id || !isChatGptUrl(tab.url)) return;

  try {
    await sendMessageToTabWithFallback(tab.id, {
      type: MESSAGE_TYPES.ASSISTANT_STREAM_SETTINGS_CHANGED
    });
  } catch {
    // The setting is persisted even if the current content script is unavailable.
  }
}

async function loadSidepanelZoom() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SIDEPANEL_UI_ZOOM);
    const stored = Number(result[STORAGE_KEYS.SIDEPANEL_UI_ZOOM]);
    sidepanelUiZoom = Number.isFinite(stored) && stored >= 0.5 && stored <= 2.5
      ? stored
      : 1;
  } catch (error) {
    console.warn('Failed to load side-panel zoom:', error);
    sidepanelUiZoom = 1;
  }
}

async function saveSidepanelZoom(nextZoom) {
  const value = Number(nextZoom);
  if (!Number.isFinite(value)) return;
  sidepanelUiZoom = Math.max(0.5, Math.min(2.5, value));
  await chrome.storage.local.set({
    [STORAGE_KEYS.SIDEPANEL_UI_ZOOM]: sidepanelUiZoom
  });
}

async function loadDebugSettings() {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.DEBUG_LOG_ENABLED,
      STORAGE_KEYS.DEBUG_LOG_LEVELS
    ]);
    debugLogEnabled = result[STORAGE_KEYS.DEBUG_LOG_ENABLED] === true;
    debugLogLevels = {
      ...debugLogLevels,
      ...(result[STORAGE_KEYS.DEBUG_LOG_LEVELS] || {})
    };
  } catch (error) {
    console.warn('Failed to load debug settings:', error);
  }
}

function createAssistantStreamSettingsHTML() {
  const mode = assistantStreamSettings.mode || DEFAULT_ASSISTANT_STREAM_SETTINGS.mode;
  return `
    <div class="popup-settings-card">
      <h3>${i18n('assistantStreamSettingsTitle') || 'Answer Grouping'}</h3>
      <p class="setting-help">${i18n('assistantStreamSettingsDescription') || 'Choose how multi-part assistant output is represented in the graph.'}</p>
      <label class="stream-mode-option" for="assistant-stream-final-only">
        <input type="radio" name="assistant-stream-mode" id="assistant-stream-final-only"
          value="${ASSISTANT_STREAM_OUTPUT_MODES.FINAL_ONLY}"
          ${mode === ASSISTANT_STREAM_OUTPUT_MODES.FINAL_ONLY ? 'checked' : ''}>
        <span>
          <strong>${i18n('assistantStreamFinalOnlyLabel') || 'Use only the final answer'}</strong>
          <small>${i18n('assistantStreamFinalOnlyDescription') || 'Keep the last completed answer as the graph node.'}</small>
        </span>
      </label>
      <label class="stream-mode-option" for="assistant-stream-merge-all">
        <input type="radio" name="assistant-stream-mode" id="assistant-stream-merge-all"
          value="${ASSISTANT_STREAM_OUTPUT_MODES.MERGE_ALL}"
          ${mode === ASSISTANT_STREAM_OUTPUT_MODES.MERGE_ALL ? 'checked' : ''}>
        <span>
          <strong>${i18n('assistantStreamMergeAllLabel') || 'Merge all streamed parts'}</strong>
          <small>${i18n('assistantStreamMergeAllDescription') || 'Keep all visible parts while storing the group as one graph node.'}</small>
        </span>
      </label>
    </div>
  `;
}

function createCollapseSettingsHTML() {
  const disabledClass = collapseSettings.enabled ? '' : 'setting-disabled';
  return `
    <div class="collapse-settings">
      <h3>${i18n('collapseSettingsTitle') || 'Content Collapse Settings'}</h3>
      <div class="setting-item">
        <label for="collapse-enabled">
          <input type="checkbox" id="collapse-enabled" ${collapseSettings.enabled ? 'checked' : ''}>
          ${i18n('collapseEnabled') || 'Enable auto collapse'}
        </label>
      </div>
      <div class="setting-group ${disabledClass}" id="collapse-options">
        <div class="setting-item">
          <label for="collapse-threshold">${i18n('collapseThreshold') || 'Collapse threshold'}</label>
          <div>
            <input type="number" id="collapse-threshold" value="${collapseSettings.threshold}" min="50" max="2000" step="50">
            <span class="unit">${i18n('collapseThresholdUnit') || 'characters'}</span>
          </div>
        </div>
        <div class="setting-item">
          <label for="collapse-question">
            <input type="checkbox" id="collapse-question" ${collapseSettings.autoCollapseQuestion ? 'checked' : ''}>
            ${i18n('collapseQuestion') || 'Auto collapse questions'}
          </label>
        </div>
        <div class="setting-item">
          <label for="collapse-answer">
            <input type="checkbox" id="collapse-answer" ${collapseSettings.autoCollapseAnswer ? 'checked' : ''}>
            ${i18n('collapseAnswer') || 'Auto collapse answers'}
          </label>
        </div>
      </div>
    </div>
  `;
}

function createSidepanelZoomSettingsHTML() {
  const percent = Math.round(sidepanelUiZoom * 100);
  const clamped = Math.max(SIDEPANEL_ZOOM_MIN, Math.min(SIDEPANEL_ZOOM_MAX, percent));
  return `
    <div class="collapse-settings">
      <h3>${i18n('sidepanelZoomTitle') || 'Panel UI Zoom'}</h3>
      <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
          <span class="status-label">${i18n('sidepanelZoomLabel') || 'Zoom (independent from webpage)'}</span>
          <span class="zoom-value" id="sidepanel-zoom-value">${clamped}%</span>
        </div>
        <div class="zoom-row">
          <input type="range" id="sidepanel-zoom-range"
            min="${SIDEPANEL_ZOOM_MIN}" max="${SIDEPANEL_ZOOM_MAX}"
            step="${SIDEPANEL_ZOOM_STEP}" value="${clamped}">
          <button class="mini-btn" id="sidepanel-zoom-reset">${i18n('reset') || 'Reset'}</button>
        </div>
      </div>
    </div>
  `;
}

function createDebugSettingsHTML() {
  const disabledClass = debugLogEnabled ? '' : 'setting-disabled';
  return `
    <div class="collapse-settings">
      <h3>${i18n('debugLogTitle') || 'Developer Options'}</h3>
      <div class="setting-item">
        <label for="debug-log-enabled">
          <input type="checkbox" id="debug-log-enabled" ${debugLogEnabled ? 'checked' : ''}>
          ${i18n('debugLogEnabled') || 'Enable debug logging'}
        </label>
      </div>
      <div class="setting-group ${disabledClass}" id="debug-log-levels">
        <div class="setting-item"><label><input type="checkbox" id="debug-log-verbose" ${debugLogLevels.verbose ? 'checked' : ''}>${i18n('debugLogVerbose') || 'Verbose (log/debug/info)'}</label></div>
        <div class="setting-item"><label><input type="checkbox" id="debug-log-warn" ${debugLogLevels.warn ? 'checked' : ''}>${i18n('debugLogWarn') || 'Warnings'}</label></div>
        <div class="setting-item"><label><input type="checkbox" id="debug-log-error" ${debugLogLevels.error ? 'checked' : ''}>${i18n('debugLogError') || 'Errors'}</label></div>
      </div>
    </div>
  `;
}

function renderPopupSettingsPanel() {
  const panel = document.getElementById('popup-settings-panel');
  if (!panel) return;
  panel.innerHTML = createAssistantStreamSettingsHTML();
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
    const open = !panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', open);
    button.setAttribute('aria-expanded', String(!open));
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
    if (value < 50 || value > 2000) return;
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

function bindZoomSettingsEvents() {
  const range = document.getElementById('sidepanel-zoom-range');
  const value = document.getElementById('sidepanel-zoom-value');
  const reset = document.getElementById('sidepanel-zoom-reset');

  range?.addEventListener('input', () => {
    if (value) value.textContent = `${range.value}%`;
  });
  range?.addEventListener('change', () => saveSidepanelZoom(Number(range.value) / 100));
  reset?.addEventListener('click', async () => {
    if (range) range.value = '100';
    if (value) value.textContent = '100%';
    await saveSidepanelZoom(1);
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

async function toggleDockFromPopup() {
  const tab = await getActiveTab();
  if (!tab?.id || !isChatGptUrl(tab.url)) {
    alert('Open a ChatGPT conversation first.');
    return;
  }

  await sendMessageToTabWithFallback(tab.id, { type: 'CG_TOGGLE_DOCKED_PANEL' });
  window.close();
}

function renderCommonSettings() {
  return [
    createCollapseSettingsHTML(),
    createSidepanelZoomSettingsHTML(),
    createDebugSettingsHTML()
  ].join('');
}

function bindCommonSettings() {
  bindCollapseSettingsEvents();
  bindZoomSettingsEvents();
  bindDebugSettingsEvents();
}

async function loadStatusContent() {
  const container = document.getElementById('content');
  if (!container) return;

  try {
    const result = await chrome.storage.local.get([
      'accessToken',
      'tokenTimestamp',
      'tokenSource'
    ]);

    const hasToken = Boolean(result.accessToken);
    const tokenSource = result.tokenSource || 'manual';
    const tokenAge = result.tokenTimestamp ? Date.now() - result.tokenTimestamp : null;
    const tokenAgeMinutes = tokenAge === null ? 0 : Math.floor(tokenAge / 60000);
    const tokenAgeHours = tokenAge === null ? 0 : Math.floor(tokenAge / 3600000);
    const tokenExpired = tokenAge !== null && tokenAge > 24 * 60 * 60 * 1000;

    if (!hasToken) {
      container.innerHTML = `
        <div class="status">
          <div class="status-item">
            <span class="status-label">${i18n('statusLabel')}</span>
            <span class="status-value warning">${i18n('waitingForToken') || 'Waiting for token...'}</span>
          </div>
        </div>
        <div class="help"><p><strong>${i18n('autoTokenTitle') || 'Automatic token capture'}</strong><br><br>${i18n('autoTokenMessage') || 'Use ChatGPT normally and the extension will capture the required token automatically.'}</p></div>
        <div class="actions"><button class="secondary" id="setup-btn">${i18n('manualSetupBtn') || 'Manual Setup'}</button></div>
        ${renderCommonSettings()}
      `;
      document.getElementById('setup-btn')?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/setup/index.html') });
      });
      bindCommonSettings();
      return;
    }

    const sourceLabel = tokenSource === 'auto'
      ? (i18n('tokenSourceAuto') || 'Automatic')
      : (i18n('tokenSourceManual') || 'Manual');
    const tokenPreview = `${result.accessToken.slice(0, 40)}...`;
    const timeDisplay = tokenAgeHours > 0
      ? i18n(tokenAgeHours > 1 ? 'hoursAgo' : 'hourAgo', String(tokenAgeHours))
      : i18n(tokenAgeMinutes > 1 ? 'minutesAgo' : 'minuteAgo', String(tokenAgeMinutes));

    container.innerHTML = `
      <div class="status">
        <div class="status-item">
          <span class="status-label">${i18n('authenticationLabel')}</span>
          <span class="status-value ${tokenExpired ? 'warning' : 'success'}">${tokenExpired ? i18n('tokenExpired') : i18n('authenticated')}</span>
        </div>
        <div class="status-item">
          <span class="status-label">${i18n('tokenSourceLabel') || 'Source'}</span>
          <span class="status-value">${sourceLabel}</span>
        </div>
      </div>
      <div class="token-info">
        <h3>${i18n('tokenInfoTitle')}</h3>
        <div class="token-preview">${tokenPreview}</div>
        <div class="token-time">
          ${i18n('tokenLength', String(result.accessToken.length))}<br>
          ${i18n('tokenCaptured', timeDisplay)}
          ${tokenExpired ? `<br><strong style="color:#dc2626;">${i18n('tokenExpiredWarning')}</strong>` : ''}
        </div>
      </div>
      <div class="actions"><button class="primary" id="toggle-dock-btn">Toggle Graph Panel</button></div>
      <div class="actions">
        <button class="secondary" id="update-btn">${i18n('manualSetupBtn') || 'Manual Setup'}</button>
        <button class="secondary" id="clear-btn">${i18n('clearTokenBtn')}</button>
      </div>
      <div class="help"><p>${tokenExpired
        ? (i18n('tokenExpiredAutoHelp') || 'The token has expired. Using ChatGPT normally should refresh it automatically.')
        : tokenSource === 'auto'
          ? (i18n('autoTokenReadyHelp') || 'The token was captured automatically and will be renewed as needed.')
          : i18n('readyHelp')}</p></div>
      ${renderCommonSettings()}
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
      if (!confirm(i18n('confirmClearToken'))) return;
      try {
        await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_TOKEN });
      } catch {
        await chrome.storage.local.remove(['accessToken', 'tokenTimestamp', 'tokenSource', 'tokenInfo']);
      }
      await loadStatusContent();
    });
  } catch (error) {
    console.error('Failed to load status:', error);
    container.innerHTML = `
      <div class="status"><div class="status-item">
        <span class="status-label">${i18n('errorLabel')}</span>
        <span class="status-value error">${i18n('errorLoadFailed')}</span>
      </div></div>
      <div class="help"><p><strong>${i18n('errorLabel')}:</strong> ${error.message}</p></div>
    `;
  }
}

async function loadStatus() {
  await initI18n();
  await Promise.all([
    loadCollapseSettings(),
    loadAssistantStreamSettings(),
    loadSidepanelZoom(),
    loadDebugSettings()
  ]);
  bindHeaderSettingsButton();
  renderPopupSettingsPanel();
  await loadStatusContent();
}

document.addEventListener('DOMContentLoaded', loadStatus);
