/**
 * Shared constants.
 */

export const EXTENSION_NAME = 'ChatGPT Graph';
export const LOG_PREFIX = `[${EXTENSION_NAME}]`;

export const API_ENDPOINTS = {
  CONVERSATION: '/backend-api/conversation',
  CONVERSATIONS: '/backend-api/conversations',
  ME: '/backend-api/me'
};

export const MESSAGE_TYPES = {
  // Content script -> service worker
  CONVERSATION_LOADED: 'CONVERSATION_LOADED',
  CONVERSATION_UPDATED: 'CONVERSATION_UPDATED',
  CONVERSATION_INCREMENTAL_UPDATE: 'CONVERSATION_INCREMENTAL_UPDATE',
  NEW_MESSAGE: 'NEW_MESSAGE',
  ERROR: 'ERROR',

  // UI -> service worker/content script
  GET_CONVERSATION: 'GET_CONVERSATION',
  GET_ALL_CONVERSATIONS: 'GET_ALL_CONVERSATIONS',
  REFRESH_DATA: 'REFRESH_DATA',
  SCROLL_TO_MESSAGE: 'SCROLL_TO_MESSAGE',

  // Authentication
  GET_TOKEN_STATUS: 'GET_TOKEN_STATUS',
  CLEAR_TOKEN: 'CLEAR_TOKEN',
  TOKEN_UPDATED: 'TOKEN_UPDATED',

  // Service worker -> UI
  DATA_READY: 'DATA_READY',
  UPDATE_NOTIFICATION: 'UPDATE_NOTIFICATION',

  // Legacy/floating UI compatibility
  TOGGLE_FLOATING_PANEL: 'TOGGLE_FLOATING_PANEL',
  UPDATE_FLOATING_PANEL_STATE: 'UPDATE_FLOATING_PANEL_STATE',
  ASSISTANT_STREAM_SETTINGS_CHANGED: 'ASSISTANT_STREAM_SETTINGS_CHANGED'
};

export const NODE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
};

export const STORAGE_KEYS = {
  CURRENT_CONVERSATION: 'current_conversation',
  CACHE_PREFIX: 'cache_',
  SETTINGS: 'settings',
  COLLAPSE_SETTINGS: 'chatgpt_graph_collapse_settings',
  SIDEPANEL_UI_ZOOM: 'chatgpt_graph_sidepanel_ui_zoom',
  DEBUG_LOG_ENABLED: 'chatgpt_graph_debug_log_enabled',
  DEBUG_LOG_LEVELS: 'chatgpt_graph_debug_log_levels',
  ASSISTANT_STREAM_SETTINGS: 'chatgpt_graph_assistant_stream_settings'
};

export const ASSISTANT_STREAM_OUTPUT_MODES = {
  MERGE_ALL: 'merge_all',
  FINAL_ONLY: 'final_only'
};

export const DEFAULT_ASSISTANT_STREAM_SETTINGS = {
  mode: ASSISTANT_STREAM_OUTPUT_MODES.FINAL_ONLY
};

export const DEFAULT_COLLAPSE_SETTINGS = {
  enabled: true,
  threshold: 200,
  autoCollapseQuestion: true,
  autoCollapseAnswer: true
};

export const CONFIG = {
  API_DELAY: 1000,
  MAX_RETRIES: 3,
  CACHE_TTL: 5 * 60 * 1000,
  MAX_CACHE_SIZE: 10,
  OBSERVER_DELAY: 500
};

export const URL_PATTERNS = {
  CONVERSATION: /\/c\/([a-f0-9-]+)/,
  CHATGPT_DOMAIN: /^https:\/\/(chatgpt\.com|chat\.openai\.com)/
};
