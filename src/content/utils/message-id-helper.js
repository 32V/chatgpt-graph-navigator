import { log } from '../../shared/utils.js';

export const TURN_CONTAINER_SELECTOR = 'section[data-turn-id], article';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractUuidFromIdAttribute(node) {
  const id = node.getAttribute('id');
  if (!id) return null;

  const imageMatch = id.match(/^image-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return imageMatch?.[1] || null;
}

function escapeSelectorValue(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function getUuidLikeTurnId(node) {
  const turnId = node?.getAttribute?.('data-turn-id');
  return turnId && UUID_REGEX.test(turnId) ? turnId : null;
}

function getInnerMessageNode(container) {
  if (!container?.querySelector) return null;
  return container.querySelector('[data-message-author-role][data-message-id]') ||
    container.querySelector('[data-message-id]');
}

export function isMessageContainer(node) {
  return Boolean(node?.matches && node.matches(TURN_CONTAINER_SELECTOR));
}

export function findMessageContainer(node) {
  if (!node) return null;
  if (isMessageContainer(node)) return node;
  return node.closest?.(TURN_CONTAINER_SELECTOR) || null;
}

export function getAllMessageContainers(root = document) {
  if (!root?.querySelectorAll) return [];
  return Array.from(root.querySelectorAll(TURN_CONTAINER_SELECTOR));
}

export function isPlaceholderMessageId(messageId) {
  return Boolean(messageId?.includes('placeholder'));
}

/**
 * Returns the best available message identifier from a mounted ChatGPT turn.
 * A UUID-like turn id is used only when explicitly allowed as a fallback.
 */
export function getUniqueMessageId(node, options = {}) {
  const { allowTurnIdFallback = true } = options;
  if (!node?.getAttribute) return null;

  if (node.hasAttribute('data-message-id')) {
    return node.getAttribute('data-message-id');
  }

  const container = findMessageContainer(node);
  if (container) {
    const innerMessage = getInnerMessageNode(container);
    if (innerMessage) return innerMessage.getAttribute('data-message-id');

    if (container.hasAttribute('data-message-id')) {
      return container.getAttribute('data-message-id');
    }

    const imageElement = container.querySelector?.('[id^="image-"]');
    if (imageElement) {
      const uuid = extractUuidFromIdAttribute(imageElement);
      if (uuid) return uuid;
    }

    if (allowTurnIdFallback) {
      const turnId = getUuidLikeTurnId(container);
      if (turnId) return turnId;
      log('warn', 'MessageIdHelper', 'Message container missing data-message-id attribute');
    }
    return null;
  }

  return extractUuidFromIdAttribute(node);
}

/**
 * Returns only stable message identifiers. Turn-id fallback is intentionally
 * disabled so one assistant turn is not processed once by turn id and again by
 * its eventual message id.
 */
export function getStableMessageId(node) {
  const messageId = getUniqueMessageId(node, { allowTurnIdFallback: false });
  return isPlaceholderMessageId(messageId) ? null : messageId;
}

export function resolveMessageId(container) {
  return getUniqueMessageId(container, { allowTurnIdFallback: true });
}

export function findArticleByMessageId(messageId) {
  if (!messageId) return null;

  const escapedId = escapeSelectorValue(messageId);
  const messageNode = document.querySelector(`[data-message-id="${escapedId}"]`);
  if (messageNode) return findMessageContainer(messageNode) || messageNode;

  let container = document.querySelector(
    `section[data-turn-id="${escapedId}"], article[data-turn-id="${escapedId}"]`
  );
  if (container) return container;

  container = document.querySelector(
    `section[data-message-id="${escapedId}"], article[data-message-id="${escapedId}"]`
  );
  if (container) return container;

  const imageNode = document.querySelector(`[id="image-${escapedId}"]`);
  if (imageNode) return findMessageContainer(imageNode) || imageNode;

  for (const candidate of getAllMessageContainers()) {
    if (resolveMessageId(candidate) === messageId || candidate.getAttribute('data-turn-id') === messageId) {
      return candidate;
    }
  }

  return null;
}

export function messageIdExistsInDOM(messageId) {
  if (!messageId) return false;
  const escapedId = escapeSelectorValue(messageId);

  return Boolean(
    document.querySelector(`[data-message-id="${escapedId}"]`) ||
    document.querySelector(`[data-turn-id="${escapedId}"]`) ||
    document.querySelector(`[id="image-${escapedId}"]`) ||
    findArticleByMessageId(messageId)
  );
}
