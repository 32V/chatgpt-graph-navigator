import { log } from '../../shared/utils.js';

export const TURN_CONTAINER_SELECTOR = 'section[data-turn-id], article';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractImageUuid(node) {
  const id = node?.getAttribute?.('id');
  return id?.match(/^image-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] || null;
}

function escapeSelectorValue(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function uuidTurnId(node) {
  const turnId = node?.getAttribute?.('data-turn-id');
  return turnId && UUID_REGEX.test(turnId) ? turnId : null;
}

function innerMessageNode(container) {
  return container?.querySelector?.('[data-message-author-role][data-message-id]') ||
    container?.querySelector?.('[data-message-id]') ||
    null;
}

export function isMessageContainer(node) {
  return Boolean(node?.matches?.(TURN_CONTAINER_SELECTOR));
}

export function findMessageContainer(node) {
  if (!node) return null;
  return isMessageContainer(node) ? node : node.closest?.(TURN_CONTAINER_SELECTOR) || null;
}

export function getAllMessageContainers(root = document) {
  return root?.querySelectorAll
    ? Array.from(root.querySelectorAll(TURN_CONTAINER_SELECTOR))
    : [];
}

function getUniqueMessageId(node, { allowTurnIdFallback = true } = {}) {
  if (!node?.getAttribute) return null;
  if (node.hasAttribute('data-message-id')) return node.getAttribute('data-message-id');

  const container = findMessageContainer(node);
  if (!container) return extractImageUuid(node);

  const messageNode = innerMessageNode(container);
  if (messageNode) return messageNode.getAttribute('data-message-id');
  if (container.hasAttribute('data-message-id')) return container.getAttribute('data-message-id');

  const imageUuid = extractImageUuid(container.querySelector?.('[id^="image-"]'));
  if (imageUuid) return imageUuid;

  if (!allowTurnIdFallback) return null;
  const turnId = uuidTurnId(container);
  if (turnId) return turnId;

  log('warn', 'MessageIdHelper', 'Message container missing a stable message identifier');
  return null;
}

/**
 * Resolve only stable message IDs so a streaming turn is not observed once via
 * its temporary turn ID and again after ChatGPT assigns the message ID.
 */
export function getStableMessageId(node) {
  const messageId = getUniqueMessageId(node, { allowTurnIdFallback: false });
  return messageId?.includes('placeholder') ? null : messageId;
}

export function resolveMessageId(container) {
  return getUniqueMessageId(container, { allowTurnIdFallback: true });
}

export function findArticleByMessageId(messageId) {
  if (!messageId) return null;

  const escapedId = escapeSelectorValue(messageId);
  const messageNode = document.querySelector(`[data-message-id="${escapedId}"]`);
  if (messageNode) return findMessageContainer(messageNode) || messageNode;

  const directContainer = document.querySelector(
    `section[data-turn-id="${escapedId}"], article[data-turn-id="${escapedId}"], ` +
    `section[data-message-id="${escapedId}"], article[data-message-id="${escapedId}"]`
  );
  if (directContainer) return directContainer;

  const imageNode = document.querySelector(`[id="image-${escapedId}"]`);
  if (imageNode) return findMessageContainer(imageNode) || imageNode;

  return getAllMessageContainers().find(candidate =>
    resolveMessageId(candidate) === messageId || candidate.getAttribute('data-turn-id') === messageId
  ) || null;
}
