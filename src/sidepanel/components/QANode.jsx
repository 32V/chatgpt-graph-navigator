import React, { memo, useCallback, useState } from 'react';
import { Handle, Position } from '@xyflow/react';

const PREVIEW_LIMIT = 72;
const COMPACT_PREVIEW_LIMIT = 58;

function truncate(text, maxLength) {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength)}…`;
}

function UserIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 10.1a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm-5.2 5.7c.6-2.5 2.5-4 5.2-4s4.6 1.5 5.2 4" />
    </svg>
  );
}

function AssistantIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.6c.45 2.85 1.95 4.35 4.8 4.8-2.85.45-4.35 1.95-4.8 4.8-.45-2.85-1.95-4.35-4.8-4.8 2.85-.45 4.35-1.95 4.8-4.8Z" />
      <path d="M15.2 12.1c.22 1.45 1 2.23 2.45 2.45-1.45.22-2.23 1-2.45 2.45-.22-1.45-1-2.23-2.45-2.45 1.45-.22 2.23-1 2.45-2.45Z" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 4v6.2c0 1.3 1.05 2.35 2.35 2.35H14" />
      <path d="M10 7.2h1.65A2.35 2.35 0 0 1 14 9.55V16" />
      <circle cx="6" cy="4" r="1.35" />
      <circle cx="14" cy="16" r="1.35" />
      <circle cx="10" cy="7.2" r="1.35" />
    </svg>
  );
}

function PlusMinusIcon({ expanded }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.5 10h9" />
      {!expanded && <path d="M10 5.5v9" />}
    </svg>
  );
}

function ExpandIcon({ expanded }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={expanded ? 'm6.5 11.5 3.5-3 3.5 3' : 'm6.5 8.5 3.5 3 3.5-3'} />
    </svg>
  );
}

function QANode({ data, selected }) {
  const [showDetails, setShowDetails] = useState(false);

  const {
    nodeType,
    nodeId,
    content,
    preview,
    isSelected,
    childCount,
    canExpand,
    isExpanded,
    onExpandAnswer,
    isInlineExpandedAnswer
  } = data;

  const isQuestion = nodeType === 'question';
  const normalizedContent = (content || '').replace(/\s+/g, ' ').trim();
  const stopEvent = useCallback(event => event.stopPropagation(), []);

  const toggleDetails = useCallback((event) => {
    event.stopPropagation();
    setShowDetails(value => !value);
  }, []);

  const toggleAnswerExpand = useCallback((event) => {
    event.stopPropagation();
    onExpandAnswer?.(nodeId);
  }, [onExpandAnswer, nodeId]);

  if (isInlineExpandedAnswer) {
    return (
      <article
        className={`qa-node answer compact-answer ${isSelected ? 'on-path' : ''} ${selected ? 'selected' : ''}`}
        data-node-role="answer"
        aria-current={selected ? 'true' : undefined}
      >
        <Handle type="target" position={Position.Top} className="qa-node-handle" />
        <span className="qa-node-compact-icon" aria-hidden="true"><AssistantIcon /></span>
        <p className="qa-node-compact-text" title={content}>
          {truncate(preview || content, COMPACT_PREVIEW_LIMIT) || 'Empty response'}
        </p>
        <div className="qa-node-path-indicator" aria-hidden="true" />
        <Handle type="source" position={Position.Bottom} className="qa-node-handle" />
      </article>
    );
  }

  const hasMore = normalizedContent.length > PREVIEW_LIMIT;

  return (
    <article
      className={`qa-node ${nodeType} ${isSelected ? 'on-path' : ''} ${selected ? 'selected' : ''}`}
      data-node-role={nodeType}
      aria-current={selected ? 'true' : undefined}
    >
      <Handle type="target" position={Position.Top} className="qa-node-handle" />

      <div className="qa-node-header">
        <div className="qa-node-role">
          <span className="qa-node-role-icon">
            {isQuestion ? <UserIcon /> : <AssistantIcon />}
          </span>
          <span className="qa-node-label">{isQuestion ? 'You' : 'ChatGPT'}</span>
        </div>

        <div className="qa-node-actions">
          {childCount > 1 && (
            <span className="qa-node-branch-count" title={`${childCount} branches`}>
              <BranchIcon />
              <span>{childCount}</span>
            </span>
          )}

          {canExpand && (
            <button
              className="qa-node-icon-btn qa-node-expand-answer-btn"
              onClick={toggleAnswerExpand}
              onMouseDown={stopEvent}
              title={isExpanded ? 'Hide response node' : 'Show response node'}
              aria-label={isExpanded ? 'Hide response node' : 'Show response node'}
              aria-pressed={isExpanded}
              type="button"
            >
              <PlusMinusIcon expanded={isExpanded} />
            </button>
          )}

          {hasMore && (
            <button
              className="qa-node-icon-btn qa-node-expand-btn"
              onClick={toggleDetails}
              onMouseDown={stopEvent}
              title={showDetails ? 'Hide full message' : 'Show full message'}
              aria-label={showDetails ? 'Hide full message' : 'Show full message'}
              aria-expanded={showDetails}
              type="button"
            >
              <ExpandIcon expanded={showDetails} />
            </button>
          )}
        </div>
      </div>

      <div className="qa-node-content">
        <p className="qa-node-text" title={content}>
          {truncate(preview || content, PREVIEW_LIMIT) || <em className="qa-node-empty">Empty message</em>}
        </p>
      </div>

      {showDetails && (
        <div
          className="qa-node-detail nodrag nopan nowheel"
          role="dialog"
          aria-label={isQuestion ? 'Full user message' : 'Full ChatGPT message'}
          onClick={stopEvent}
          onDoubleClick={stopEvent}
          onMouseDown={stopEvent}
          onPointerDown={stopEvent}
          onWheel={stopEvent}
        >
          {normalizedContent || 'Empty message'}
        </div>
      )}

      <div className="qa-node-path-indicator" aria-hidden="true" />
      <Handle type="source" position={Position.Bottom} className="qa-node-handle" />
    </article>
  );
}

export default memo(QANode);
