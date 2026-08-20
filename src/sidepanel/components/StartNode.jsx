import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

function StartIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="5" r="1.4" />
      <circle cx="15" cy="15" r="1.4" />
      <path d="M5 6.4v3.2A3.4 3.4 0 0 0 8.4 13H15" />
    </svg>
  );
}

function StartNode() {
  return (
    <div className="start-node">
      <span className="start-node-icon"><StartIcon /></span>
      <span className="start-node-text">Start</span>
      <Handle type="source" position={Position.Bottom} className="qa-node-handle" />
    </div>
  );
}

export default memo(StartNode);
