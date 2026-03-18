import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const TYPE_ICONS = { text: 'T', image: '\u{1F5BC}', svg: '\u2B21' };

export default function TreeNode({ node, nodeType, isSelected, onSelect, onAction, depth = 0, children }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: node._key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    paddingLeft: `${depth * 16}px`,
  };

  const isZone = nodeType === 'zone';
  const icon = isZone ? '\u25A2' : (TYPE_ICONS[node.type] || '?');
  const label = isZone ? (node.name || 'Unnamed Zone') : (node.name || node.text || node.type || 'Layer');

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className={`pd-tree-node pd-tree-node--${nodeType}${isSelected ? ' pd-tree-node--selected' : ''}`}
        onClick={() => onSelect(node, nodeType)}
      >
        <span className="pd-tree-node__drag" {...listeners} title="Drag to reorder">⠿</span>
        <span className="pd-tree-node__icon">{icon}</span>
        <span className="pd-tree-node__label">{label}</span>

        {isZone && (
          <span className="pd-tree-node__badge">{node.behavior}</span>
        )}

        <span className="pd-tree-node__actions">
          {isZone && (
            <button
              className="pd-tree-node__action"
              onClick={(e) => { e.stopPropagation(); onAction('add-layer', node); }}
              title="Add layer"
            >+</button>
          )}
          <button
            className="pd-tree-node__action"
            onClick={(e) => { e.stopPropagation(); onAction('toggle-visibility', node); }}
            title={node.visible === false ? 'Show' : 'Hide'}
          >{node.visible === false ? '\u25CB' : '\u25C9'}</button>
          <button
            className="pd-tree-node__action"
            onClick={(e) => { e.stopPropagation(); onAction('toggle-lock', node); }}
            title={node.locked ? 'Unlock' : 'Lock'}
          >{node.locked ? '\u{1F512}' : '\u{1F513}'}</button>
          <button
            className="pd-tree-node__action pd-tree-node__action--danger"
            onClick={(e) => { e.stopPropagation(); onAction('delete', node); }}
            title="Delete"
          >&times;</button>
        </span>
      </div>
      {children}
    </div>
  );
}
