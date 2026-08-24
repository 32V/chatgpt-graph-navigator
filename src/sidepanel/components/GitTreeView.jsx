import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getQATreeStructureKey } from '../utils/qa-tree.js';

const iconUrl = (name) => chrome.runtime.getURL(`assets/${name}`);
const PREVIEW_LIMIT = 110;

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max = PREVIEW_LIMIT) {
  const normalized = normalizeText(text);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function highlight(text, query) {
  const normalized = normalizeText(text);
  if (!query) return normalized;

  const index = normalized.toLowerCase().indexOf(query);
  if (index < 0) return normalized;

  return (
    <>
      {normalized.slice(0, index)}
      <mark className="git-mark">{normalized.slice(index, index + query.length)}</mark>
      {normalized.slice(index + query.length)}
    </>
  );
}

function dedupeById(items, getId) {
  const result = [];
  const seen = new Set();
  for (const item of items || []) {
    const id = getId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}

function buildSearchIndex(qaTree, displayMode) {
  if (!qaTree) return [];

  const items = [];
  if (displayMode !== 'a') {
    qaTree.qNodeMap?.forEach(node => items.push({ id: node.userId, text: node.content || '' }));
  }
  if (displayMode !== 'q') {
    qaTree.aNodeMap?.forEach(node => items.push({ id: node.assistantId, text: node.content || '' }));
  }
  return items;
}

function buildKeepSet(matchIds, parentMap) {
  const keep = new Set();
  for (const id of matchIds) {
    let current = id;
    const visited = new Set();
    while (current && !visited.has(current)) {
      visited.add(current);
      keep.add(current);
      current = parentMap?.get(current);
    }
  }
  return keep;
}

function getQChildren(qNode) {
  const answers = qNode.answers || [];
  if (answers.length === 0) return { mode: 'none', items: [] };
  if (answers.length === 1) {
    return {
      mode: 'collapsedAnswer',
      answer: answers[0],
      items: answers[0].nextQuestions || []
    };
  }
  return { mode: 'answers', items: answers };
}

function getNextQuestionsFromQuestion(qNode) {
  return dedupeById(
    (qNode.answers || []).flatMap(answer => answer.nextQuestions || []),
    question => question.userId
  );
}

function getNextAnswersFromAnswer(aNode) {
  return dedupeById(
    (aNode.nextQuestions || []).flatMap(question => question.answers || []),
    answer => answer.assistantId
  );
}

function initialExpandedNodes(qaTree) {
  const expanded = new Set();

  qaTree?.root?.questions?.forEach(question => expanded.add(question.userId));
  qaTree?.qNodeMap?.forEach((question) => {
    const childInfo = getQChildren(question);
    if (childInfo.mode === 'answers' ||
        (childInfo.mode === 'collapsedAnswer' && childInfo.items.length > 0)) {
      expanded.add(question.userId);
    }
  });
  qaTree?.aNodeMap?.forEach((answer) => {
    if ((answer.nextQuestions || []).length > 0) expanded.add(answer.assistantId);
  });

  return expanded;
}

function sameSet(a, b) {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function extendRenderPath(path, key) {
  if (path.has(key)) return null;
  const next = new Set(path);
  next.add(key);
  return next;
}

export default function GitTreeView({
  conversationId,
  qaTree,
  selectedPath,
  currentNodeId,
  onNodeClick
}) {
  const containerRef = useRef(null);
  const conversationRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [displayMode, setDisplayModeState] = useState('all');
  const [toolbarCollapsed, setToolbarCollapsedState] = useState(false);
  const [fontScale, setFontScaleState] = useState(1);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    chrome.storage.local.get([
      'gitTreeDisplayMode',
      'gitTreeToolbarCollapsed',
      'gitTreeFontScale'
    ]).then((result) => {
      if (result.gitTreeDisplayMode === 'all' || result.gitTreeDisplayMode === 'q' || result.gitTreeDisplayMode === 'a') {
        setDisplayModeState(result.gitTreeDisplayMode);
      }
      if (typeof result.gitTreeToolbarCollapsed === 'boolean') {
        setToolbarCollapsedState(result.gitTreeToolbarCollapsed);
      }
      const scale = Number(result.gitTreeFontScale);
      if (Number.isFinite(scale)) {
        setFontScaleState(Math.min(1.35, Math.max(0.85, scale)));
      }
    }).catch(() => {});
  }, []);

  const setDisplayMode = useCallback((mode) => {
    if (mode !== 'all' && mode !== 'q' && mode !== 'a') return;
    setDisplayModeState(mode);
    chrome.storage.local.set({ gitTreeDisplayMode: mode }).catch(() => {});
  }, []);

  const setToolbarCollapsed = useCallback((collapsed) => {
    const next = Boolean(collapsed);
    setToolbarCollapsedState(next);
    chrome.storage.local.set({ gitTreeToolbarCollapsed: next }).catch(() => {});
  }, []);

  const setFontScale = useCallback((value) => {
    const next = Math.min(1.35, Math.max(0.85, Number(value) || 1));
    setFontScaleState(next);
    chrome.storage.local.set({ gitTreeFontScale: next }).catch(() => {});
  }, []);

  const query = useMemo(() => normalizeText(searchQuery).toLowerCase(), [searchQuery]);
  const structureKey = useMemo(() => getQATreeStructureKey(qaTree), [qaTree]);
  const searchIndex = useMemo(
    () => buildSearchIndex(qaTree, displayMode),
    [qaTree, displayMode]
  );
  const matchIds = useMemo(() => {
    if (!query) return [];
    return searchIndex
      .filter(item => normalizeText(item.text).toLowerCase().includes(query))
      .map(item => item.id);
  }, [query, searchIndex]);
  const matchSet = useMemo(() => new Set(matchIds), [matchIds]);
  const keepSet = useMemo(
    () => query ? buildKeepSet(matchIds, qaTree?.parentMap) : null,
    [query, matchIds, qaTree]
  );

  useEffect(() => {
    if (!qaTree) {
      conversationRef.current = conversationId || null;
      setExpanded(previous => previous.size === 0 ? previous : new Set());
      return;
    }

    const conversationChanged = conversationRef.current !== conversationId;
    conversationRef.current = conversationId;

    setExpanded((previous) => {
      const next = conversationChanged
        ? initialExpandedNodes(qaTree)
        : new Set(previous);

      selectedPath?.forEach(id => next.add(id));
      for (const id of Array.from(next)) {
        if (!qaTree.qNodeMap?.has(id) && !qaTree.aNodeMap?.has(id)) next.delete(id);
      }

      return sameSet(previous, next) ? previous : next;
    });
  }, [conversationId, qaTree, selectedPath, structureKey]);

  useEffect(() => {
    if (!query || !keepSet) return;
    setExpanded(previous => {
      const next = new Set(previous);
      keepSet.forEach(id => next.add(id));
      return sameSet(previous, next) ? previous : next;
    });
  }, [query, keepSet]);

  useEffect(() => {
    if (!currentNodeId || !containerRef.current) return;
    let cancelled = false;

    const scrollToCurrent = (attempt = 0) => {
      if (cancelled) return;
      const root = containerRef.current?.querySelector('.git-root');
      if (!root) return;

      const escapedId = window.CSS?.escape
        ? window.CSS.escape(currentNodeId)
        : currentNodeId.replace(/["\\]/g, '\\$&');
      const element = root.querySelector(`[data-node-id="${escapedId}"]`);
      if (!element) {
        if (attempt < 5) requestAnimationFrame(() => scrollToCurrent(attempt + 1));
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const targetTop = root.scrollTop +
        (elementRect.top - rootRect.top) -
        (rootRect.height - elementRect.height) / 2;
      const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);

      let targetLeft = root.scrollLeft;
      if (elementRect.left < rootRect.left) targetLeft -= rootRect.left - elementRect.left;
      else if (elementRect.right > rootRect.right) targetLeft += elementRect.right - rootRect.right;
      const maxLeft = Math.max(0, root.scrollWidth - root.clientWidth);

      root.scrollTo({
        top: Math.max(0, Math.min(targetTop, maxTop)),
        left: Math.max(0, Math.min(targetLeft, maxLeft)),
        behavior: 'smooth'
      });
    };

    requestAnimationFrame(() => scrollToCurrent());
    return () => { cancelled = true; };
  }, [currentNodeId]);

  const toggleExpand = useCallback((id) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const shouldShow = useCallback(
    id => !query || !keepSet || keepSet.has(id),
    [query, keepSet]
  );

  const jumpToNode = useCallback((id, nodeType) => {
    onNodeClick?.(id, { messageId: id, nodeType });
  }, [onNodeClick]);

  const handleSearchKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' || matchIds.length === 0) return;
    const id = matchIds[0];
    jumpToNode(id, qaTree?.qNodeMap?.has(id) ? 'question' : 'answer');
  }, [matchIds, jumpToNode, qaTree]);

  function renderExpander(id, hasChildren, isExpanded) {
    return (
      <button
        className={`git-expander${hasChildren ? '' : ' git-expander-empty'}`}
        onClick={(event) => {
          event.stopPropagation();
          if (hasChildren) toggleExpand(id);
        }}
        aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : 'No children'}
        type="button"
      >
        {hasChildren ? (isExpanded ? '▾' : '▸') : '•'}
      </button>
    );
  }

  function renderAnswerNodeAll(aNode, ancestry = new Set(), forceShow = false) {
    const id = aNode.assistantId;
    const path = extendRenderPath(ancestry, `a:${id}`);
    if (!id || !path || (!forceShow && !shouldShow(id))) return null;

    const children = aNode.nextQuestions || [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(id);
    const isSelected = selectedPath?.has(id);
    const isCurrent = currentNodeId === id;
    const isMatched = matchSet.has(id);

    return (
      <li key={id} className="git-li">
        <div
          className={`git-row git-a${isSelected ? ' git-selected' : ''}${isCurrent ? ' git-current' : ''}${isMatched ? ' git-matched' : ''}`}
          data-node-id={id}
          onClick={() => jumpToNode(id, 'answer')}
          title={truncate(aNode.content, 260)}
        >
          {renderExpander(id, hasChildren, isExpanded)}
          <span className="git-badge git-badge-a">A</span>
          <span className="git-text">{highlight(truncate(aNode.preview || aNode.content), query)}</span>
        </div>
        {hasChildren && isExpanded && (
          <ul className={`git-ul ${children.length > 1 ? 'git-ul-branch' : 'git-ul-flat'}`}>
            {children.map(question => renderQuestionNodeAll(question, path))}
          </ul>
        )}
      </li>
    );
  }

  function renderQuestionNodeAll(qNode, ancestry = new Set()) {
    const id = qNode.userId;
    const path = extendRenderPath(ancestry, `q:${id}`);
    if (!id || !path || !shouldShow(id)) return null;

    const childInfo = getQChildren(qNode);
    const hasChildren = childInfo.mode === 'answers' || childInfo.items.length > 0;
    const isExpanded = expanded.has(id);
    const isSelected = selectedPath?.has(id);
    const isCurrent = currentNodeId === id;
    const isMatched = matchSet.has(id);
    const forceShowAnswers = Boolean(query && (isMatched || isSelected));

    return (
      <li key={id} className="git-li">
        <div
          className={`git-row git-q${isSelected ? ' git-selected' : ''}${isCurrent ? ' git-current' : ''}${isMatched ? ' git-matched' : ''}`}
          data-node-id={id}
          onClick={() => jumpToNode(id, 'question')}
          title={truncate(qNode.content, 260)}
        >
          {renderExpander(id, hasChildren, isExpanded)}
          <span className="git-badge">Q</span>
          <span className="git-text">{highlight(truncate(qNode.preview || qNode.content), query)}</span>
          {(qNode.answers || []).length > 1 && (
            <span className="git-meta">{qNode.answers.length} answers</span>
          )}
        </div>

        {childInfo.mode === 'collapsedAnswer' && childInfo.answer?.assistantId && (
          <div
            className={`git-inline-answer${selectedPath?.has(childInfo.answer.assistantId) ? ' git-inline-selected' : ''}${currentNodeId === childInfo.answer.assistantId ? ' git-current' : ''}${matchSet.has(childInfo.answer.assistantId) ? ' git-inline-matched' : ''}`}
            data-node-id={childInfo.answer.assistantId}
            onClick={(event) => {
              event.stopPropagation();
              jumpToNode(childInfo.answer.assistantId, 'answer');
            }}
            title={truncate(childInfo.answer.content, 260)}
          >
            <span className="git-inline-badge">A</span>
            <span className="git-inline-text">
              {highlight(truncate(childInfo.answer.preview || childInfo.answer.content, 96), query)}
            </span>
          </div>
        )}

        {hasChildren && isExpanded && (
          <ul className={`git-ul ${childInfo.mode === 'answers' || childInfo.items.length > 1 ? 'git-ul-branch' : 'git-ul-flat'}`}>
            {childInfo.mode === 'answers'
              ? childInfo.items.map(answer => renderAnswerNodeAll(answer, path, forceShowAnswers))
              : childInfo.items.map(question => renderQuestionNodeAll(question, path))}
          </ul>
        )}
      </li>
    );
  }

  function renderQuestionOnly(qNode, ancestry = new Set()) {
    const id = qNode.userId;
    const path = extendRenderPath(ancestry, `q:${id}`);
    if (!id || !path || !shouldShow(id)) return null;

    const children = getNextQuestionsFromQuestion(qNode);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(id);
    const isSelected = selectedPath?.has(id);
    const isCurrent = currentNodeId === id;
    const isMatched = matchSet.has(id);

    return (
      <li key={id} className="git-li">
        <div
          className={`git-row git-q${isSelected ? ' git-selected' : ''}${isCurrent ? ' git-current' : ''}${isMatched ? ' git-matched' : ''}`}
          data-node-id={id}
          onClick={() => jumpToNode(id, 'question')}
          title={truncate(qNode.content, 260)}
        >
          {renderExpander(id, hasChildren, isExpanded)}
          <span className="git-badge">Q</span>
          <span className="git-text">{highlight(truncate(qNode.preview || qNode.content), query)}</span>
          {(qNode.answers || []).length > 0 && (
            <span className="git-meta">{qNode.answers.length} answer{qNode.answers.length === 1 ? '' : 's'}</span>
          )}
        </div>
        {hasChildren && isExpanded && (
          <ul className={`git-ul ${children.length > 1 ? 'git-ul-branch' : 'git-ul-flat'}`}>
            {children.map(question => renderQuestionOnly(question, path))}
          </ul>
        )}
      </li>
    );
  }

  function renderAnswerOnly(aNode, ancestry = new Set()) {
    const id = aNode.assistantId;
    const path = extendRenderPath(ancestry, `a:${id}`);
    if (!id || !path || !shouldShow(id)) return null;

    const children = getNextAnswersFromAnswer(aNode);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(id);
    const isSelected = selectedPath?.has(id);
    const isCurrent = currentNodeId === id;
    const isMatched = matchSet.has(id);

    return (
      <li key={id} className="git-li">
        <div
          className={`git-row git-a${isSelected ? ' git-selected' : ''}${isCurrent ? ' git-current' : ''}${isMatched ? ' git-matched' : ''}`}
          data-node-id={id}
          onClick={() => jumpToNode(id, 'answer')}
          title={truncate(aNode.content, 260)}
        >
          {renderExpander(id, hasChildren, isExpanded)}
          <span className="git-badge git-badge-a">A</span>
          <span className="git-text">{highlight(truncate(aNode.preview || aNode.content), query)}</span>
        </div>
        {hasChildren && isExpanded && (
          <ul className={`git-ul ${children.length > 1 ? 'git-ul-branch' : 'git-ul-flat'}`}>
            {children.map(answer => renderAnswerOnly(answer, path))}
          </ul>
        )}
      </li>
    );
  }

  if (!qaTree?.root) {
    return (
      <div className="git-tree-empty">
        <img src={iconUrl('tree.svg')} alt="" className="git-tree-empty-icon" />
        <div className="git-tree-empty-title">No conversation tree</div>
        <div className="git-tree-empty-sub">Open a ChatGPT conversation to see its branches.</div>
      </div>
    );
  }

  const rootQuestions = qaTree.root.questions || [];
  const visibleRootQuestions = query && keepSet
    ? rootQuestions.filter(question => keepSet.has(question.userId))
    : rootQuestions;
  const rootAnswers = dedupeById(
    rootQuestions.flatMap(question => question.answers || []),
    answer => answer.assistantId
  );
  const visibleRootAnswers = query && keepSet
    ? rootAnswers.filter(answer => keepSet.has(answer.assistantId))
    : rootAnswers;

  let rootElement = null;
  if (displayMode === 'a' && visibleRootAnswers.length > 0) {
    rootElement = <ul className="git-ul git-root">{visibleRootAnswers.map(answer => renderAnswerOnly(answer))}</ul>;
  } else if (displayMode === 'q' && visibleRootQuestions.length > 0) {
    rootElement = <ul className="git-ul git-root">{visibleRootQuestions.map(question => renderQuestionOnly(question))}</ul>;
  } else if (displayMode === 'all' && visibleRootQuestions.length > 0) {
    rootElement = <ul className="git-ul git-root">{visibleRootQuestions.map(question => renderQuestionNodeAll(question))}</ul>;
  }

  const placeholder = displayMode === 'q'
    ? 'Search questions'
    : displayMode === 'a'
      ? 'Search answers'
      : 'Search conversation';

  return (
    <div className="git-tree" ref={containerRef} style={{ '--gitScale': String(fontScale) }}>
      <div className={`git-toolbar${toolbarCollapsed ? ' collapsed' : ''}`}>
        {toolbarCollapsed ? (
          <button
            className="git-toolbar-reopen"
            onClick={() => setToolbarCollapsed(false)}
            type="button"
            aria-label="Show search and filters"
            title="Show search and filters"
          >
            <img src={iconUrl('search.svg')} alt="" />
            <span>Search and filters</span>
          </button>
        ) : (
          <div className="git-toolbar-row git-toolbar-row2">
            <div className="git-search">
              <img src={iconUrl('search.svg')} alt="" className="git-search-icon" />
              <input
                className="git-search-input"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={placeholder}
                type="search"
              />
              {searchQuery && (
                <button
                  className="git-search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                  aria-label="Clear search"
                  type="button"
                >
                  ×
                </button>
              )}
            </div>

            <div className="git-toolbar-controls">
              <div className="git-filter-toggle" role="tablist" aria-label="Visible node types">
                {[
                  ['all', 'QA', 'Show questions and answers'],
                  ['q', 'Q', 'Show questions only'],
                  ['a', 'A', 'Show answers only']
                ].map(([mode, label, title]) => (
                  <button
                    key={mode}
                    className={`git-filter-btn${displayMode === mode ? ' active' : ''}`}
                    onClick={() => setDisplayMode(mode)}
                    title={title}
                    aria-label={title}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="git-font-control" title="Tree text size">
                <span className="git-font-label">Aa</span>
                <input
                  className="git-font-range"
                  type="range"
                  min="0.85"
                  max="1.35"
                  step="0.05"
                  value={fontScale}
                  onChange={event => setFontScale(event.target.value)}
                  aria-label="Tree text size"
                />
              </label>

              <button
                className="git-collapse-btn"
                onClick={() => setToolbarCollapsed(true)}
                title="Hide search and filters"
                aria-label="Hide search and filters"
                type="button"
              >
                <img className="toolbar-icon" src={iconUrl('up.svg')} alt="" />
              </button>
            </div>
          </div>
        )}
      </div>

      {rootElement || (
        <div className="git-no-results">
          <div className="git-no-results-title">No results</div>
          <div className="git-no-results-sub">Try a different search or filter.</div>
        </div>
      )}
    </div>
  );
}
