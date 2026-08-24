/**
 * Adds lightweight collapse controls to long ChatGPT messages.
 */

import {
  STORAGE_KEYS,
  DEFAULT_COLLAPSE_SETTINGS
} from '../../shared/constants.js';
import { log } from '../../shared/utils.js';
import { TURN_CONTAINER_SELECTOR } from '../utils/message-id-helper.js';
import { COLLAPSE_STYLES, COLLAPSE_ICON_SVG, EXPAND_ICON_SVG } from './collapse-styles.js';

let settings = { ...DEFAULT_COLLAPSE_SETTINGS };
let observer = null;
let styleElement = null;
let isInitialized = false;

const messageStates = new WeakMap();

async function getCollapseSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.COLLAPSE_SETTINGS);
    const stored = result[STORAGE_KEYS.COLLAPSE_SETTINGS];
    if (stored) return { ...DEFAULT_COLLAPSE_SETTINGS, ...stored };
  } catch (error) {
    log('warn', 'Collapse', 'Failed to load settings:', error);
  }
  return { ...DEFAULT_COLLAPSE_SETTINGS };
}

function injectStyles() {
  if (styleElement) return;
  styleElement = document.createElement('style');
  styleElement.id = 'chatgpt-graph-collapse-styles';
  styleElement.textContent = COLLAPSE_STYLES;
  document.head.appendChild(styleElement);
}

function findContentContainer(container) {
  return container.querySelector(
    '.markdown, .whitespace-pre-wrap, [data-message-content], [data-message-author-role]'
  );
}

function getMessageTextLength(container) {
  const content = findContentContainer(container);
  return (content?.textContent || '').trim().length;
}

function getMessageType(container) {
  const ownRole = container.getAttribute('data-message-author-role');
  if (ownRole === 'user' || ownRole === 'assistant') return ownRole;

  if (container.querySelector('[data-message-author-role="user"]')) return 'user';
  if (container.querySelector('[data-message-author-role="assistant"]')) return 'assistant';

  if (container.querySelector('h5')) return 'user';
  if (container.querySelector('h6')) return 'assistant';
  return null;
}

function findActionButton(container, kind) {
  const testIdSelector = kind === 'copy'
    ? 'button[data-testid*="copy"]'
    : 'button[data-testid*="more"]';
  const ariaSelector = kind === 'copy'
    ? 'button[aria-label*="Copy" i]'
    : 'button[aria-label*="More" i]';
  return container.querySelector(`${testIdSelector}, ${ariaSelector}`);
}

function findButtonContainer(container, messageType) {
  const preferred = messageType === 'assistant'
    ? findActionButton(container, 'more') || findActionButton(container, 'copy')
    : findActionButton(container, 'copy');
  return preferred?.parentElement || null;
}

function isElementInViewport(element) {
  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  return rect.top >= 0 && rect.top < windowHeight;
}

function updateButtonState(button, isCollapsed) {
  button.innerHTML = isCollapsed ? EXPAND_ICON_SVG : COLLAPSE_ICON_SVG;
  button.className = `chatgpt-graph-collapse-btn ${isCollapsed ? 'collapsed' : ''}`;
  button.setAttribute('aria-label', isCollapsed ? 'Expand' : 'Collapse');
  button.title = isCollapsed ? 'Expand' : 'Collapse';
}

function setCollapseState(contentContainer, isCollapsed) {
  contentContainer.classList.toggle('chatgpt-graph-collapsed', isCollapsed);
}

function shouldAutoCollapse(messageType) {
  if (!settings.enabled) return false;
  if (messageType === 'user' && !settings.autoCollapseQuestion) return false;
  if (messageType === 'assistant' && !settings.autoCollapseAnswer) return false;
  return true;
}

function processMessage(container, isSettingsUpdate = false) {
  const existingState = messageStates.get(container);
  if (existingState) {
    if (isSettingsUpdate) {
      const nextCollapsed = shouldAutoCollapse(existingState.messageType);
      if (nextCollapsed !== existingState.isCollapsed) {
        existingState.isCollapsed = nextCollapsed;
        setCollapseState(existingState.contentContainer, nextCollapsed);
        updateButtonState(existingState.button, nextCollapsed);
      }
    }
    return;
  }

  const messageType = getMessageType(container);
  if (!messageType) return;

  const textLength = getMessageTextLength(container);
  if (textLength < settings.threshold) return;

  const contentContainer = findContentContainer(container);
  const buttonContainer = findButtonContainer(container, messageType);
  if (!contentContainer || !buttonContainer) return;

  contentContainer.classList.add('chatgpt-graph-collapsible');
  const isCollapsed = shouldAutoCollapse(messageType);
  setCollapseState(contentContainer, isCollapsed);

  const button = document.createElement('button');
  button.type = 'button';
  updateButtonState(button, isCollapsed);

  const state = {
    messageType,
    contentContainer,
    button,
    isCollapsed
  };
  messageStates.set(container, state);

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    state.isCollapsed = !state.isCollapsed;
    setCollapseState(contentContainer, state.isCollapsed);
    updateButtonState(button, state.isCollapsed);

    if (state.isCollapsed) {
      setTimeout(() => {
        if (!isElementInViewport(container)) {
          container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    }
  });

  const moreButton = messageType === 'assistant' ? findActionButton(container, 'more') : null;
  if (moreButton?.parentElement === buttonContainer) {
    buttonContainer.insertBefore(button, moreButton);
  } else {
    buttonContainer.appendChild(button);
  }

  log('debug', 'Collapse', `Processed ${messageType} message (${textLength} chars, collapsed: ${isCollapsed})`);
}

function processAllMessages(isSettingsUpdate = false) {
  document.querySelectorAll(TURN_CONTAINER_SELECTOR).forEach((container) => {
    try {
      processMessage(container, isSettingsUpdate);
    } catch (error) {
      log('warn', 'Collapse', 'Failed to process message:', error);
    }
  });
}

function startObserver() {
  if (observer) return;
  const targetNode = document.querySelector('main') || document.body;

  observer = new MutationObserver((mutations) => {
    const hasAddedElements = mutations.some((mutation) =>
      mutation.type === 'childList' &&
      Array.from(mutation.addedNodes).some((node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node.matches?.(TURN_CONTAINER_SELECTOR) || node.querySelector?.(TURN_CONTAINER_SELECTOR))
      )
    );

    if (hasAddedElements) setTimeout(() => processAllMessages(false), 100);
  });

  observer.observe(targetNode, { childList: true, subtree: true });
}

export async function initCollapseManager() {
  if (isInitialized) return;
  settings = await getCollapseSettings();
  injectStyles();
  processAllMessages(false);
  startObserver();
  isInitialized = true;
}

async function updateCollapseSettings() {
  settings = await getCollapseSettings();
  processAllMessages(true);
}

export function setupSettingsListener() {
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.COLLAPSE_SETTINGS]) {
      void updateCollapseSettings();
    }
  });
}
