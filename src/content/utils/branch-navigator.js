/**
 * Branch navigation helpers.
 *
 * Conversation topology comes from ChatGPT's backend mapping. The DOM is used
 * only as an actuator: to identify the currently rendered sibling, expose a
 * virtualized turn, and click ChatGPT's native branch controls.
 */

import { log } from '../../shared/utils.js';
import {
  resolveMessageId,
  findArticleByMessageId,
  getAllMessageContainers
} from './message-id-helper.js';

const BRANCH_COUNTER_RE = /^(\d+)\s*\/\s*(\d+)$/;
const PREV_LABEL_RE = /(?:\bprev(?:ious)?\b|\bearlier\b|이전)/i;
const NEXT_LABEL_RE = /(?:\bnext\b|\blater\b|다음)/i;
const MAX_NAV_STEPS = 128;
const BRANCH_CHANGE_TIMEOUT = 3000;
const MOUNT_TIMEOUT = 6000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRendered(element) {
  if (!element?.isConnected) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function buttonLabel(button) {
  return [
    button?.getAttribute?.('aria-label'),
    button?.getAttribute?.('title'),
    button?.textContent
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function isDisabledButton(button) {
  return !button || button.disabled || button.getAttribute('aria-disabled') === 'true';
}

function parseBranchCounter(element) {
  const text = (element?.textContent || '').trim();
  const match = text.match(BRANCH_COUNTER_RE);
  if (!match) return null;

  const current = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 1) return null;
  if (current < 1 || current > total) return null;

  return { current, total };
}

function rankButtonsNearCounter(counter, buttons) {
  if (!counter) return [];
  const counterRect = counter.getBoundingClientRect();
  const counterX = (counterRect.left + counterRect.right) / 2;
  const counterY = (counterRect.top + counterRect.bottom) / 2;

  return buttons
    .map(button => {
      const rect = button.getBoundingClientRect();
      const centerX = (rect.left + rect.right) / 2;
      const centerY = (rect.top + rect.bottom) / 2;
      return {
        button,
        centerX,
        distance: Math.abs(centerX - counterX) + Math.abs(centerY - counterY),
        visible: rect.width > 0 && rect.height > 0
      };
    })
    .filter(candidate => candidate.visible)
    .sort((a, b) => a.distance - b.distance);
}

function nearestButtonsToCounter(counter, buttons) {
  const ranked = rankButtonsNearCounter(counter, buttons);
  if (ranked.length < 2) return null;

  const counterRect = counter.getBoundingClientRect();
  const counterX = (counterRect.left + counterRect.right) / 2;
  const left = ranked.find(candidate => candidate.centerX < counterX);
  const right = ranked.find(candidate => candidate.centerX > counterX);
  if (!left || !right || left.distance > 240 || right.distance > 240) return null;

  return { prevButton: left.button, nextButton: right.button };
}

function findControlsAroundCounter(counter) {
  const info = parseBranchCounter(counter);
  if (!info) return null;

  let scope = counter.parentElement;
  for (let depth = 0; depth < 6 && scope; depth++) {
    const buttons = Array.from(scope.querySelectorAll('button'));
    const ranked = rankButtonsNearCounter(counter, buttons);
    const prevButton = ranked.find(({ button, distance }) =>
      distance <= 240 && PREV_LABEL_RE.test(buttonLabel(button))
    )?.button || null;
    const nextButton = ranked.find(({ button, distance }) =>
      distance <= 240 && NEXT_LABEL_RE.test(buttonLabel(button))
    )?.button || null;

    // Prefer semantic controls that are spatially close to the counter. At the
    // first/last branch ChatGPT may omit one edge button entirely, so one
    // identified direction is still useful.
    if (prevButton || nextButton) {
      return { ...info, counter, prevButton, nextButton };
    }

    if (buttons.length >= 2) {
      const positional = nearestButtonsToCounter(counter, buttons);
      if (positional) {
        return { ...info, counter, ...positional };
      }
    }
    scope = scope.parentElement;
  }

  return null;
}

function revealTurnControls(article) {
  if (!article) return;
  const rect = article.getBoundingClientRect();
  const init = {
    bubbles: true,
    clientX: Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
    clientY: Math.max(0, Math.min(window.innerHeight - 1, rect.top + Math.min(rect.height / 2, 80)))
  };
  article.dispatchEvent(new MouseEvent('mouseover', init));
  article.dispatchEvent(new MouseEvent('mouseenter', init));
}

function findBranchControls(id) {
  const article = findArticleByMessageId(id);
  if (!article) return null;

  const scopes = [
    article,
    article.closest?.('[data-turn-id-container]'),
    article.parentElement
  ].filter(Boolean);

  for (const scope of new Set(scopes)) {
    const candidates = Array.from(scope.querySelectorAll('span, div'));
    for (const candidate of candidates) {
      const controls = findControlsAroundCounter(candidate);
      if (controls) return controls;
    }
  }

  return null;
}

/**
 * Returns IDs for the turns that are currently mounted in the ChatGPT DOM.
 * This is intentionally not treated as the full active branch because ChatGPT
 * virtualizes long conversations.
 */
export function getCurrentDisplayedPath() {
  return getAllMessageContainers()
    .map(container => resolveMessageId(container) || container.getAttribute('data-turn-id'))
    .filter(Boolean);
}

export function getBranchInfo(id) {
  const controls = findBranchControls(id);
  return controls ? { current: controls.current, total: controls.total } : null;
}

export function clickBranchButton(id, direction) {
  const controls = findBranchControls(id);
  if (!controls) {
    log('warn', 'BranchNav', `Branch controls not found for ${id}`);
    return false;
  }

  const button = direction === 'prev' ? controls.prevButton : controls.nextButton;
  if (isDisabledButton(button)) {
    log('warn', 'BranchNav', `Branch button ${direction} is disabled for ${id}`);
    return false;
  }

  try {
    button.click();
    return true;
  } catch (error) {
    log('error', 'BranchNav', `Failed to click ${direction}: ${error.message}`);
    return false;
  }
}

function findMountedSibling(siblingIds, excludeId = null) {
  for (const siblingId of siblingIds) {
    if (siblingId === excludeId) continue;
    const article = findArticleByMessageId(siblingId);
    if (article && isRendered(article)) return siblingId;
  }
  return null;
}

/**
 * Wait until a different member of a sibling group is rendered.
 */
export function waitForBranchChange(oldId, timeout = BRANCH_CHANGE_TIMEOUT, siblingIds = null) {
  return new Promise(resolve => {
    const start = Date.now();

    const check = () => {
      if (Array.isArray(siblingIds) && siblingIds.length > 0) {
        const current = findMountedSibling(siblingIds, oldId);
        if (current) {
          resolve(current);
          return;
        }
      } else {
        const oldArticle = findArticleByMessageId(oldId);
        if (!oldArticle || !isRendered(oldArticle)) {
          resolve(null);
          return;
        }
      }

      if (Date.now() - start >= timeout) {
        resolve(null);
        return;
      }
      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}

/**
 * Build a root-to-target path from canonical node parent links.
 */
export function buildPathToTarget(targetId, nodeMap) {
  const path = [];
  const visited = new Set();
  let currentId = targetId;

  while (currentId && nodeMap.has(currentId) && !visited.has(currentId)) {
    visited.add(currentId);
    path.unshift(currentId);
    currentId = nodeMap.get(currentId)?.parent || null;
  }

  return path;
}

/**
 * Return sibling IDs in graph order. For root-level nodes the filtered parent
 * may be absent, so creation order is the fallback. Navigation verifies actual
 * message IDs and does not rely on this order when it disagrees with the UI.
 */
export function getSiblings(nodeId, nodeMap) {
  const node = nodeMap.get(nodeId);
  if (!node) return [nodeId];

  if (node.parent) {
    const parent = nodeMap.get(node.parent);
    if (!parent?.children?.length) return [nodeId];
    return parent.children.filter(id => nodeMap.has(id));
  }

  const rawParent = node._rawParent || null;
  return Array.from(nodeMap.values())
    .filter(candidate => !candidate.parent && (rawParent ? candidate._rawParent === rawParent : true))
    .sort((a, b) => {
      const timeDiff = (a.createTime || 0) - (b.createTime || 0);
      return timeDiff || String(a.id).localeCompare(String(b.id));
    })
    .map(candidate => candidate.id);
}

export function getSiblingIndex(nodeId, nodeMap) {
  const siblings = getSiblings(nodeId, nodeMap);
  const index = siblings.indexOf(nodeId);
  return index >= 0 ? index + 1 : 1;
}

function buildDepthMap(nodes) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const cache = new Map();

  const depthOf = (id, visiting = new Set()) => {
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);

    const parentId = nodeMap.get(id)?.parent;
    const depth = parentId && nodeMap.has(parentId) ? depthOf(parentId, visiting) + 1 : 0;
    cache.set(id, depth);
    visiting.delete(id);
    return depth;
  };

  for (const node of nodes) depthOf(node.id);
  return cache;
}

function findScrollContainer() {
  const sample = getAllMessageContainers()[0];
  let current = sample?.parentElement || document.querySelector('main');

  while (current) {
    const style = window.getComputedStyle(current);
    const scrollable =
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight;
    if (scrollable) return current;
    current = current.parentElement;
  }

  return document.scrollingElement || document.documentElement;
}

function mountedDepthRange(nodeMap, depthMap) {
  const depths = [];
  for (const container of getAllMessageContainers()) {
    const id = resolveMessageId(container) || container.getAttribute('data-turn-id');
    if (id && nodeMap.has(id) && depthMap.has(id) && isRendered(container)) {
      depths.push(depthMap.get(id));
    }
  }

  if (depths.length === 0) return null;
  return { min: Math.min(...depths), max: Math.max(...depths) };
}

async function mountSiblingGroup(siblingIds, targetDepth, nodeMap, depthMap, timeout = MOUNT_TIMEOUT) {
  let current = findMountedSibling(siblingIds);
  if (current) return current;

  const scrollContainer = findScrollContainer();
  if (!scrollContainer) return null;

  const setScrollTop = (top) => {
    if (typeof scrollContainer.scrollTo === 'function') {
      scrollContainer.scrollTo({ top, behavior: 'auto' });
    } else {
      scrollContainer.scrollTop = top;
    }
  };

  let maxDepth = 1;
  for (const depth of depthMap.values()) {
    if (depth > maxDepth) maxDepth = depth;
  }
  let maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  if (maxScrollTop > 0) {
    const estimated = Math.round((targetDepth / maxDepth) * maxScrollTop);
    setScrollTop(estimated);
    await sleep(120);
  }

  const started = Date.now();
  let lastTop = -1;
  while (Date.now() - started < timeout) {
    current = findMountedSibling(siblingIds);
    if (current) return current;

    const range = mountedDepthRange(nodeMap, depthMap);
    const step = Math.max(240, Math.round(scrollContainer.clientHeight * 0.75));
    let nextTop = scrollContainer.scrollTop;

    if (!range) {
      nextTop += step;
    } else if (targetDepth < range.min) {
      nextTop -= step;
    } else if (targetDepth > range.max) {
      nextTop += step;
    } else {
      // The desired logical depth is near the viewport but the exact turn is
      // not mounted yet. Nudge toward the corresponding half of the range.
      const midpoint = (range.min + range.max) / 2;
      const direction = targetDepth <= midpoint ? -1 : 1;
      nextTop += direction * Math.max(120, Math.round(step / 2));
    }

    maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    const clamped = Math.max(0, Math.min(maxScrollTop, nextTop));
    if (Math.abs(clamped - lastTop) < 1) {
      const opposite = Math.max(0, Math.min(maxScrollTop, clamped - step));
      if (Math.abs(opposite - clamped) < 1) break;
      setScrollTop(opposite);
      lastTop = opposite;
    } else {
      setScrollTop(clamped);
      lastTop = clamped;
    }
    await sleep(140);
  }

  return findMountedSibling(siblingIds);
}

async function getControlsForMountedSibling(currentId) {
  let controls = findBranchControls(currentId);
  if (controls) return controls;

  const article = findArticleByMessageId(currentId);
  article?.scrollIntoView({ behavior: 'auto', block: 'center' });
  revealTurnControls(article);
  await sleep(180);
  return findBranchControls(currentId);
}

async function moveSiblingOnce(currentId, direction, siblingIds) {
  const controls = await getControlsForMountedSibling(currentId);
  if (!controls) return null;

  const button = direction === 'next' ? controls.nextButton : controls.prevButton;
  if (isDisabledButton(button)) return null;

  button.click();
  const nextId = await waitForBranchChange(currentId, BRANCH_CHANGE_TIMEOUT, siblingIds);
  if (nextId) await sleep(100);
  return nextId;
}

async function scanSiblingGroupForTarget(currentId, targetId, siblingIds) {
  // First walk to the first native branch, checking every ID on the way.
  for (let step = 0; step < MAX_NAV_STEPS; step++) {
    if (currentId === targetId) return currentId;
    const controls = await getControlsForMountedSibling(currentId);
    if (!controls) return null;
    if (controls.current <= 1) break;

    const nextId = await moveSiblingOnce(currentId, 'prev', siblingIds);
    if (!nextId) return null;
    currentId = nextId;
  }

  // Then enumerate forward. This fallback is independent of graph sibling
  // ordering and therefore survives ordering differences between mapping data
  // and the native branch counter.
  for (let step = 0; step < MAX_NAV_STEPS; step++) {
    if (currentId === targetId) return currentId;
    const controls = await getControlsForMountedSibling(currentId);
    if (!controls) return null;
    if (controls.current >= controls.total) break;

    const nextId = await moveSiblingOnce(currentId, 'next', siblingIds);
    if (!nextId) return null;
    currentId = nextId;
  }

  return currentId === targetId ? currentId : null;
}

async function switchSiblingGroup(targetId, siblingIds, targetDepth, nodeMap, depthMap) {
  const targetIndex = siblingIds.indexOf(targetId) + 1;
  if (targetIndex <= 0) return false;

  let currentId = await mountSiblingGroup(siblingIds, targetDepth, nodeMap, depthMap);
  if (!currentId) {
    log('warn', 'BranchNav', `Could not mount sibling group for ${targetId}`);
    return false;
  }
  if (currentId === targetId) return true;

  let controls = await getControlsForMountedSibling(currentId);
  if (!controls) {
    log('warn', 'BranchNav', `Branch controls unavailable for ${currentId}`);
    return false;
  }

  const currentGraphIndex = siblingIds.indexOf(currentId) + 1;
  const graphOrderMatchesUI =
    controls.total === siblingIds.length &&
    currentGraphIndex > 0 &&
    currentGraphIndex === controls.current;

  if (graphOrderMatchesUI) {
    for (let step = 0; step < MAX_NAV_STEPS && currentId !== targetId; step++) {
      controls = await getControlsForMountedSibling(currentId);
      if (!controls) return false;

      const direction = targetIndex > controls.current ? 'next' : 'prev';
      const nextId = await moveSiblingOnce(currentId, direction, siblingIds);
      if (!nextId) break;
      currentId = nextId;

      // If the observed ID no longer agrees with the native counter, fall back
      // to an ID-based scan rather than trusting the graph order.
      const observedIndex = siblingIds.indexOf(currentId) + 1;
      const nextControls = await getControlsForMountedSibling(currentId);
      if (!nextControls || observedIndex !== nextControls.current) break;
    }

    if (currentId === targetId) return true;
  } else {
    log('debug', 'BranchNav', 'Graph/UI sibling order mismatch; using ID-based branch scan', {
      graphCount: siblingIds.length,
      uiCount: controls.total,
      currentGraphIndex,
      currentUiIndex: controls.current
    });
  }

  return !!(await scanSiblingGroupForTarget(currentId, targetId, siblingIds));
}

/**
 * Switch the native ChatGPT control associated with one sibling group.
 */
export async function switchToBranchIndex(startMessageId, targetIndex) {
  const firstControls = findBranchControls(startMessageId);
  if (!firstControls || targetIndex < 1 || targetIndex > firstControls.total) return false;
  if (firstControls.current === targetIndex) return true;

  let currentId = startMessageId;
  let displayed = getCurrentDisplayedPath();
  const mountedIndex = displayed.indexOf(startMessageId);
  if (mountedIndex < 0) return false;

  for (let step = 0; step < MAX_NAV_STEPS; step++) {
    const controls = findBranchControls(currentId);
    if (!controls) return false;
    if (controls.current === targetIndex) return true;

    const direction = targetIndex > controls.current ? 'next' : 'prev';
    const button = direction === 'next' ? controls.nextButton : controls.prevButton;
    if (isDisabledButton(button)) return false;

    const oldId = currentId;
    button.click();
    await waitForBranchChange(oldId);
    await sleep(100);

    displayed = getCurrentDisplayedPath();
    currentId = displayed[mountedIndex];
    if (!currentId) return false;
  }

  return findBranchControls(currentId)?.current === targetIndex;
}

/**
 * Navigate to an arbitrary graph node by progressively enforcing each branch
 * choice on the canonical root-to-target path.
 */
export async function navigateToMessage(targetId, nodes) {
  log('info', 'BranchNav', `Navigating to message: ${targetId}`);

  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  if (!nodeMap.has(targetId)) {
    return { success: false, message: `Target node not found: ${targetId}` };
  }

  const targetPath = buildPathToTarget(targetId, nodeMap);
  const depthMap = buildDepthMap(nodes);

  for (const nodeId of targetPath) {
    const siblings = getSiblings(nodeId, nodeMap);
    if (siblings.length <= 1) continue;

    const ok = await switchSiblingGroup(
      nodeId,
      siblings,
      depthMap.get(nodeId) || 0,
      nodeMap,
      depthMap
    );

    if (!ok) {
      return { success: false, message: `Could not switch to branch containing ${nodeId}` };
    }
  }

  let targetArticle = findArticleByMessageId(targetId);
  if (!targetArticle || !isRendered(targetArticle)) {
    const mounted = await mountSiblingGroup(
      [targetId],
      depthMap.get(targetId) || 0,
      nodeMap,
      depthMap
    );
    if (!mounted) {
      return { success: false, message: 'Target branch selected, but target turn could not be mounted' };
    }
    targetArticle = findArticleByMessageId(targetId);
  }

  if (!targetArticle || !isRendered(targetArticle)) {
    return { success: false, message: 'Target message is still not rendered' };
  }

  return { success: true, message: 'Navigation successful' };
}
