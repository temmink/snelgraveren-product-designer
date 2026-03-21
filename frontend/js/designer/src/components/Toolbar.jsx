import React, { useRef } from 'react';
import { __ } from '@wordpress/i18n';
import useDesignerStore from '../store/useDesignerStore';
import useCanvasHistory from '../hooks/useCanvasHistory';

export default function Toolbar() {
  const {
    activeTool, setActiveTool, template, fabricCanvasRef, currentViewIndex, historyByView,
    drawingStrokeWidth, drawingStrokeColor, setDrawingStrokeWidth, setDrawingStrokeColor,
  } = useDesignerStore();
  // Wrap the store canvas value in a ref so useCanvasHistory can read .current at call time.
  const canvasRef = useRef(null);
  canvasRef.current = fabricCanvasRef;
  const { undo, redo } = useCanvasHistory(canvasRef, currentViewIndex);
  const vh = historyByView[currentViewIndex];
  const canUndo = vh?.undoStack?.length > 0;
  const canRedo = vh?.redoStack?.length > 0;
  const globalConfig = template?.global_config || {};
  const drawingEnabled = globalConfig.drawing_enabled || false;

  return (
    <div className="pf-toolbar">
      <div className="pf-toolbar__group">
        <button
          type="button"
          className="pf-toolbar__btn"
          onClick={undo}
          disabled={!canUndo}
          title={__('Undo (Ctrl+Z)', 'productforge')}
        >↩</button>
        <button
          type="button"
          className="pf-toolbar__btn"
          onClick={redo}
          disabled={!canRedo}
          title={__('Redo (Ctrl+Shift+Z)', 'productforge')}
        >↪</button>
      </div>

      {drawingEnabled && (
        <>
          <div className="pf-toolbar__separator" />
          <div className="pf-toolbar__group">
            <button
              type="button"
              className={`pf-toolbar__btn${activeTool === 'select' || !['draw', 'erase'].includes(activeTool) ? ' pf-toolbar__btn--active' : ''}`}
              onClick={() => setActiveTool('select')}
              title={__('Select', 'productforge')}
            >↖</button>
            <button
              type="button"
              className={`pf-toolbar__btn${activeTool === 'draw' ? ' pf-toolbar__btn--active' : ''}`}
              onClick={() => setActiveTool(activeTool === 'draw' ? 'select' : 'draw')}
              title={__('Draw', 'productforge')}
            >✏</button>
            <button
              type="button"
              className={`pf-toolbar__btn${activeTool === 'erase' ? ' pf-toolbar__btn--active' : ''}`}
              onClick={() => setActiveTool(activeTool === 'erase' ? 'select' : 'erase')}
              title={__('Eraser', 'productforge')}
            >🧹</button>
          </div>
          <DrawingOptions />
        </>
      )}
    </div>
  );
}

function DrawingOptions() {
  const { activeTool, drawingStrokeWidth, drawingStrokeColor, setDrawingStrokeWidth, setDrawingStrokeColor } = useDesignerStore();

  if (activeTool !== 'draw' && activeTool !== 'erase') return null;

  return (
    <>
      <div className="pf-toolbar__separator" />
      <div className="pf-toolbar__group pf-toolbar__group--options">
        <label className="pf-toolbar__option">
          <span>{__('Size', 'productforge')}</span>
          <input
            type="range"
            min="1"
            max="50"
            value={drawingStrokeWidth}
            onChange={(e) => setDrawingStrokeWidth(parseInt(e.target.value, 10))}
          />
        </label>
        {activeTool === 'draw' && (
          <label className="pf-toolbar__option">
            <span>{__('Color', 'productforge')}</span>
            <input
              type="color"
              value={drawingStrokeColor}
              onChange={(e) => setDrawingStrokeColor(e.target.value)}
            />
          </label>
        )}
      </div>
    </>
  );
}
