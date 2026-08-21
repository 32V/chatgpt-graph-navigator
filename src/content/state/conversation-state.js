import {
  ASSISTANT_STREAM_OUTPUT_MODES,
  DEFAULT_ASSISTANT_STREAM_SETTINGS
} from '../../shared/constants.js';

/**
 * Minimal in-memory state needed by page navigation and synchronization.
 */
class ConversationState {
  constructor() {
    this.assistantStreamSettings = { ...DEFAULT_ASSISTANT_STREAM_SETTINGS };
    this.clear();
  }

  setAssistantStreamSettings(settings = {}) {
    const validModes = Object.values(ASSISTANT_STREAM_OUTPUT_MODES);
    const mode = validModes.includes(settings.mode)
      ? settings.mode
      : DEFAULT_ASSISTANT_STREAM_SETTINGS.mode;

    this.assistantStreamSettings = {
      ...DEFAULT_ASSISTANT_STREAM_SETTINGS,
      ...settings,
      mode
    };
  }

  initialize(conversationData) {
    this.conversationId = conversationData.id;
    this.nodes = conversationData.nodes || [];
    this.currentNodeId = conversationData.currentNodeId || null;
    this.isInitialized = true;
  }

  clear() {
    this.conversationId = null;
    this.nodes = [];
    this.currentNodeId = null;
    this.isInitialized = false;
  }

  isReady() {
    return this.isInitialized && Boolean(this.conversationId);
  }

  getNodes() {
    return this.nodes;
  }
}

export const conversationState = new ConversationState();
