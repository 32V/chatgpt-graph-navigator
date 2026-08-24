/**
 * DOM actuator for branch navigation.
 *
 * Canonical topology is supplied by normalized backend nodes. This module only
 * mounts the relevant turn, discovers ChatGPT's native version controls, clicks
 * them, and verifies the resulting message ID.
 */

import { log } from '../../shared/utils.js';
import { buildDepthMap, buildPathToTarget, getSiblings } from './branch-model.js';
import {
  resolveMessageId,
  findArticleByMessageId,
  getAllMessageContainers
} from './message-id-helper.js';

const BRANCH_COUNTER_RE = /^(\d+)\s*\/\s*(\d+)$/;
const PREV_LABEL_RE = /(?:\bprev(?:ious)?\b|\bearlier\b)/i;
const NEXT_LABEL_RE = /(?:\bnext\b|\blater\b)/i;
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
  for (let depth = 0; depth < 6 && scope; depth += 1) {
    const buttons = Array.from(scope.querySelectorAll('button'));
    const ranked = rankButtonsNearCounter(counter, buttons);
    const prevButton = ranked.find(({ button, distance }) =>
      distance <= 240 && PREV_LABEL_RE.test(buttonLabel(button))
    )?.button || null;
    const nextButton = ranked.find(({ button, distance }) =>
      distance <= 240 && NEXT_LABEL_RE.test(buttonLabel(button))
    )?.button || null;

    // At the first/last branch ChatGPT may omit one edge button entirely, so a
    // single semantically identified direction is still useful.
    if (prevButton || nextButton) {
      return { ...info, counter, prevButton, nextButton };
    }

    if (buttons.length >= 2) {
      const positional = nearestButtonsToCounter(counter, buttons);
      if (positional) return { ...info, counter, ...positional };
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

function findMountedSibling(siblingIds, excludeId = null) {
  for (const siblingId of siblingIds) {
    if (siblingId === excludeId) continue;
    const article = findArticleByMessageId(siblingId);
    if (article && isRendered(article)) return siblingId;
  }
  return null;
}

function waitForBranchChange(oldId, timeout = BRANCH_CHANGE_TIMEOUT, siblingIds = null) {
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
  for (let step = 0; step < MAX_NAV_STEPS; step += 1) {
    if (currentId === targetId) return currentId;
    const controls = await getControlsForMountedSibling(currentId);
    if (!controls) return null;
    if (controls.current <= 1) break;

    const nextId = await moveSiblingOnce(currentId, 'prev', siblingIds);
    if (!nextId) return null;
    currentId = nextId;
  }

  // Enumerate forward from the first native branch. This fallback is independent
  // of mapping sibling order and therefore survives frontend ordering differences.
  for (let step = 0; step < MAX_NAV_STEPS; step += 1) {
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
    for (let step = 0; step < MAX_NAV_STEPS && currentId !== targetId; step += 1) {
      controls = await getControlsForMountedSibling(currentId);
      if (!controls) return false;

      const direction = targetIndex > controls.current ? 'next' : 'prev';
      const nextId = await moveSiblingOnce(currentId, direction, siblingIds);
      if (!nextId) break;
      currentId = nextId;

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

  return Boolean(await scanSiblingGroupForTarget(currentId, targetId, siblingIds));
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
