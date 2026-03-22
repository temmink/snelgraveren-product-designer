import React, { useState, useRef, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/* ── SVG Icons (clean, consistent 16×16) ───────────────────────────────── */
const Icons = {
  drag: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="6" cy="3" r="1.2"/><circle cx="10" cy="3" r="1.2"/>
      <circle cx="6" cy="7" r="1.2"/><circle cx="10" cy="7" r="1.2"/>
      <circle cx="6" cy="11" r="1.2"/><circle cx="10" cy="11" r="1.2"/>
    </svg>
  ),
  chevronRight: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 3l4 4-4 4"/>
    </svg>
  ),
  chevronDown: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 5l4 4 4-4"/>
    </svg>
  ),
  zone: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" strokeDasharray="3 2"/>
    </svg>
  ),
  text: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M3 2h8v2H8v8H6V4H3V2z"/>
    </svg>
  ),
  image: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2" width="11" height="10" rx="1.5"/>
      <circle cx="4.5" cy="5" r="1.2" fill="currentColor" stroke="none"/>
      <path d="M1.5 10l3-3 2 2 2.5-3L12.5 10" strokeLinejoin="round"/>
    </svg>
  ),
  svg: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <polygon points="7,1.5 12.5,5 10.5,11 3.5,11 1.5,5" strokeLinejoin="round"/>
    </svg>
  ),
  eyeOpen: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/>
      <circle cx="8" cy="8" r="2"/>
    </svg>
  ),
  eyeClosed: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/>
      <line x1="2" y1="2" x2="14" y2="14"/>
    </svg>
  ),
  locked: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3.5" y="7" width="9" height="7" rx="1.5"/>
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>
    </svg>
  ),
  unlocked: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3.5" y="7" width="9" height="7" rx="1.5"/>
      <path d="M5.5 7V5a2.5 2.5 0 015 0" />
    </svg>
  ),
  trash: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v8.5a1 1 0 001 1h4a1 1 0 001-1V4"/>
    </svg>
  ),
  plus: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="8" y1="4" x2="8" y2="12"/><line x1="4" y1="8" x2="12" y2="8"/>
    </svg>
  ),
};

const TYPE_ICON_MAP = { text: Icons.text, image: Icons.image, svg: Icons.svg };

export default function TreeNode({ node, nodeType, isSelected, isExpanded, onSelect, onAction, onToggleExpand, depth = 0, children }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: node._key });

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isZone = nodeType === 'zone';
  const icon = isZone ? Icons.zone : (TYPE_ICON_MAP[node.type] || Icons.text);
  const label = isZone ? (node.name || __( 'Unnamed Zone', 'productforge' )) : (node.name || node.text || node.type || __( 'Layer', 'productforge' ));
  const hasChildren = isZone && (node.layers || []).length > 0;

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    setEditValue(isZone ? (node.name || '') : (node.name || node.text || ''));
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRenameSubmit = () => {
    setIsEditing(false);
    if (editValue.trim() && editValue !== label) {
      if (isZone) {
        onAction('rename', node, editValue.trim());
      } else {
        onAction('rename', node, editValue.trim());
      }
    }
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className={`pf-tree-node pf-tree-node--${nodeType}${isSelected ? ' pf-tree-node--selected' : ''}${isDragging ? ' pf-tree-node--dragging' : ''}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={(e) => { e.stopPropagation(); onSelect(node, nodeType); }}
      >
        {/* Drag handle */}
        <button className="pf-tree-node__drag" {...listeners} aria-label={ __( 'Drag to reorder', 'productforge' ) } title={ __( 'Drag to reorder', 'productforge' ) }>
          {Icons.drag}
        </button>

        {/* Expand/collapse for zones */}
        {isZone ? (
          <button
            className="pf-tree-node__expand"
            onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
            aria-label={ isExpanded ? __( 'Collapse', 'productforge' ) : __( 'Expand', 'productforge' ) }
          >
            {isExpanded ? Icons.chevronDown : Icons.chevronRight}
          </button>
        ) : (
          <span className="pf-tree-node__expand-spacer" />
        )}

        {/* Type icon */}
        <span className={`pf-tree-node__icon pf-tree-node__icon--${isZone ? 'zone' : node.type}`}>{icon}</span>

        {/* Label (editable on double-click) */}
        {isEditing ? (
          <input
            ref={inputRef}
            className="pf-tree-node__edit-input"
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="pf-tree-node__label" onDoubleClick={handleDoubleClick} title={label}>
            {label}
          </span>
        )}

        {/* Badge for zones */}
        {isZone && node.behavior && (
          <span className="pf-tree-node__badge">{node.behavior}</span>
        )}

        {/* Layer count for zones */}
        {isZone && hasChildren && (
          <span className="pf-tree-node__count">{(node.layers || []).length}</span>
        )}

        {/* Actions — always visible for selected, hover for others */}
        <span className="pf-tree-node__actions">
          {isZone && (
            <button
              className="pf-tree-node__action pf-tree-node__action--add"
              onClick={(e) => { e.stopPropagation(); onAction('add-layer', node); }}
              aria-label={ __( 'Add layer', 'productforge' ) }
              title={ __( 'Add layer', 'productforge' ) }
            >{Icons.plus}</button>
          )}
          <button
            className="pf-tree-node__action"
            onClick={(e) => { e.stopPropagation(); onAction('toggle-visibility', node); }}
            aria-label={ node.visible === false ? __( 'Show', 'productforge' ) : __( 'Hide', 'productforge' ) }
            title={ node.visible === false ? __( 'Show', 'productforge' ) : __( 'Hide', 'productforge' ) }
          >{node.visible === false ? Icons.eyeClosed : Icons.eyeOpen}</button>
          <button
            className="pf-tree-node__action"
            onClick={(e) => { e.stopPropagation(); onAction('toggle-lock', node); }}
            aria-label={ node.locked ? __( 'Unlock', 'productforge' ) : __( 'Lock', 'productforge' ) }
            title={ node.locked ? __( 'Unlock', 'productforge' ) : __( 'Lock', 'productforge' ) }
          >{node.locked ? Icons.locked : Icons.unlocked}</button>
          <button
            className="pf-tree-node__action pf-tree-node__action--danger"
            onClick={(e) => { e.stopPropagation(); onAction('delete', node); }}
            aria-label={ __( 'Delete', 'productforge' ) }
            title={ __( 'Delete', 'productforge' ) }
          >{Icons.trash}</button>
        </span>
      </div>
      {children}
    </div>
  );
}
