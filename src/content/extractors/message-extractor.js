/**
 * Extracts message metadata from the currently mounted ChatGPT DOM.
 * DOM-derived relationships are advisory only; the API mapping remains the
 * canonical conversation topology.
 */

import { log } from '../../shared/utils.js';
import {
  resolveMessageId,
  findArticleByMessageId,
  findMessageContainer,
  getAllMessageContainers,
  isMessageContainer
} from '../utils/message-id-helper.js';

function getRoleFromContainer(container) {
  if (!container?.querySelector) return null;

  const roleDiv = container.querySelector('[data-message-author-role]');
  return roleDiv?.getAttribute('data-message-author-role') ||
    container.getAttribute('data-turn') ||
    null;
}

function findPreviousUserContainer(containers, fromIndex) {
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (getRoleFromContainer(containers[i]) === 'user') return containers[i];
  }
  return null;
}

function getAssistantStreamGroupInfo(container, role) {
  if (role !== 'assistant') return null;

  const main = document.querySelector('main') || document;
  const containers = getAllMessageContainers(main);
  let index = containers.indexOf(container);
  if (index === -1) {
    index = containers.findIndex(candidate => candidate === container ||
      candidate.contains(container) ||
      container.contains(candidate)
    );
  }

  if (index === -1) return null;

  let start = index;
  while (start > 0 && getRoleFromContainer(containers[start - 1]) === 'assistant') start--;

  let end = index;
  while (end < containers.length - 1 && getRoleFromContainer(containers[end + 1]) === 'assistant') end++;

  const group = containers.slice(start, end + 1);
  const firstMessageId = resolveMessageId(group[0]) || resolveMessageId(container);
  const previousUser = findPreviousUserContainer(containers, start);
  const parentUserId = previousUser ? resolveMessageId(previousUser) : null;
  const groupPrefix = parentUserId || 'root';
  const groupSeed = firstMessageId || resolveMessageId(container) || `dom-${start}`;

  return {
    key: `${groupPrefix}:${groupSeed}`,
    parentUserId,
    partIndex: Math.max(0, group.indexOf(container)),
    partCount: group.length
  };
}

export function extractMessageFromDOM(article) {
  const container = findMessageContainer(article);
  if (!container) return null;

  try {
    const id = resolveMessageId(container);

    let role = container.getAttribute('data-turn');
    const roleDiv = container.querySelector('[data-message-author-role]');
    if (roleDiv) role = roleDiv.getAttribute('data-message-author-role');

    const turnNumber = container.getAttribute('data-testid')?.match(/\d+/)?.[0];
    if (!id || !role) return null;

    let content = '';
    let contentEl = role === 'user'
      ? container.querySelector('.whitespace-pre-wrap')
      : container.querySelector('.markdown');

    if (!contentEl) contentEl = container.querySelector('[data-message-author-role] > div');

    if (contentEl) {
      content = contentEl.innerText.trim();
    } else {
      const allDivs = container.querySelectorAll('div');
      let maxLength = 0;
      allDivs.forEach((div) => {
        if (div.tagName === 'SCRIPT' || div.style.display === 'none') return;
        const text = div.innerText?.trim() || '';
        if (text.length > maxLength && text.length > 5) {
          content = text;
          maxLength = text.length;
        }
      });
    }

    // This parent guess is useful for temporary DOM metadata only. Canonical
    // graph state is reconciled from /backend-api/conversation after changes.
    let parent = null;
    let prevElement = container.previousElementSibling;
    while (prevElement) {
      if (isMessageContainer(prevElement)) {
        const prevId = resolveMessageId(prevElement);
        if (prevId) {
          parent = prevId;
          break;
        }
      }
      prevElement = prevElement.previousElementSibling;
    }

    const assistantStreamGroup = getAssistantStreamGroupInfo(container, role);
    if (assistantStreamGroup?.parentUserId) parent = assistantStreamGroup.parentUserId;

    return {
      id,
      role,
      content,
      parent,
      turnNumber: turnNumber ? parseInt(turnNumber, 10) : null,
      streamGroupKey: assistantStreamGroup?.key || null,
      streamGroupPartIndex: assistantStreamGroup?.partIndex ?? null,
      streamGroupPartCount: assistantStreamGroup?.partCount ?? null,
      timestamp: Date.now(),
      source: 'dom'
    };
  } catch (error) {
    log('error', 'MessageExtractor', 'Failed to extract message:', error);
    return null;
  }
}

export function getAllMessagesFromDOM() {
  const main = document.querySelector('main');
  if (!main) {
    log('warn', 'MessageExtractor', 'Main element not found');
    return [];
  }

  const messages = getAllMessageContainers(main)
    .map(extractMessageFromDOM)
    .filter(Boolean);

  log('info', 'MessageExtractor', `Found ${messages.length} valid messages in DOM`);
  return messages;
}

export function getLastMessageFromDOM() {
  const messages = getAllMessagesFromDOM();
  return messages[messages.length - 1] || null;
}

export function getMessageByIdFromDOM(messageId) {
  const article = findArticleByMessageId(messageId);
  return article ? extractMessageFromDOM(article) : null;
}
