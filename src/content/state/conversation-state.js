import {
  ASSISTANT_STREAM_OUTPUT_MODES,
  DEFAULT_ASSISTANT_STREAM_SETTINGS
} from '../../shared/constants.js';

/**
 * In-memory snapshot of the current canonical conversation.
 *
 * Live graph updates are reconciled from the backend mapping, so this class no
 * longer mutates graph ancestry from DOM-derived incremental messages.
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
    this.title = conversationData.title || null;
    this.mapping = { ...(conversationData.mapping || {}) };
    this.nodes = conversationData.nodes || [];
    this.edges = conversationData.edges || [];
    this.rounds = conversationData.rounds || [];
    this.branches = conversationData.branches || [];
    this.analysis = conversationData.analysis || null;
    this.createTime = conversationData.createTime || null;
    this.updateTime = conversationData.updateTime || null;
    this.lastUpdateTime = Date.now();
    this.isInitialized = true;
  }

  clear() {
    this.conversationId = null;
    this.title = null;
    this.mapping = {};
    this.nodes = [];
    this.edges = [];
    this.rounds = [];
    this.branches = [];
    this.analysis = null;
    this.createTime = null;
    this.updateTime = null;
    this.lastUpdateTime = null;
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
