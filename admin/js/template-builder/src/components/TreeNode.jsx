import React from 'react';
import { __ } from '@wordpress/i18n';
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
  const label = isZone ? (node.name || __( 'Unnamed Zone', 'productforge' )) : (node.name || node.text || node.type || __( 'Layer', 'productforge' ));

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className={`pf-tree-node pf-tree-node--${nodeType}${isSelected ? ' pf-tree-node--selected' : ''}`}
        onClick={(e) => { e.stopPropagation(); onSelect(node, nodeType); }}
      >
        <button className="pf-tree-node__drag" {...listeners} aria-label={ __( 'Drag to reorder', 'productforge' ) } title={ __( 'Drag to reorder', 'productforge' ) }>⠿</button>
        <span className="pf-tree-node__icon">{icon}</span>
        <span className="pf-tree-node__label">{label}</span>

        {isZone && (
          <span className="pf-tree-node__badge">{node.behavior}</span>
        )}

        <span className="pf-tree-node__actions">
          {isZone && (
            <button
              className="pf-tree-node__action"
              onClick={(e) => { e.stopPropagation(); onAction('add-layer', node); }}
              aria-label={ __( 'Add layer', 'productforge' ) }
              title={ __( 'Add layer', 'productforge' ) }
            >+</button>
          )}
          <button
            className="pf-tree-node__action"
            onClick={(e) => { e.stopPropagation(); onAction('toggle-visibility', node); }}
            aria-label={ node.visible === false ? __( 'Show layer', 'productforge' ) : __( 'Hide layer', 'productforge' ) }
            title={ node.visible === false ? __( 'Show', 'productforge' ) : __( 'Hide', 'productforge' ) }
          >{node.visible === false ? '\u25CB' : '\u25C9'}</button>
          <button
            className="pf-tree-node__action"
            onClick={(e) => { e.stopPropagation(); onAction('toggle-lock', node); }}
            aria-label={ node.locked ? __( 'Unlock layer', 'productforge' ) : __( 'Lock layer', 'productforge' ) }
            title={ node.locked ? __( 'Unlock', 'productforge' ) : __( 'Lock', 'productforge' ) }
          >{node.locked ? '\u{1F512}' : '\u{1F513}'}</button>
          <button
            className="pf-tree-node__action pf-tree-node__action--danger"
            onClick={(e) => { e.stopPropagation(); onAction('delete', node); }}
            aria-label={ __( 'Delete', 'productforge' ) }
            title={ __( 'Delete', 'productforge' ) }
          >&times;</button>
        </span>
      </div>
      {children}
    </div>
  );
}
