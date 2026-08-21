/**
 * Shared constants used by the extension runtime.
 */

export const LOG_PREFIX = '[ChatGPT Graph]';

export const API_ENDPOINTS = {
  CONVERSATION: '/backend-api/conversation'
};

export const MESSAGE_TYPES = {
  CONVERSATION_LOADED: 'CONVERSATION_LOADED',
  ERROR: 'ERROR',
  GET_CONVERSATION: 'GET_CONVERSATION',
  REFRESH_DATA: 'REFRESH_DATA',
  SCROLL_TO_MESSAGE: 'SCROLL_TO_MESSAGE',
  CLEAR_TOKEN: 'CLEAR_TOKEN',
  DATA_READY: 'DATA_READY',
  ASSISTANT_STREAM_SETTINGS_CHANGED: 'ASSISTANT_STREAM_SETTINGS_CHANGED'
};

export const NODE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
};

export const STORAGE_KEYS = {
  COLLAPSE_SETTINGS: 'chatgpt_graph_collapse_settings',
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
  API_DELAY: 1000
};
