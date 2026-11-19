import './designer.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FabricImage } from 'fabric';
import { installSvgImageRender } from '../../../../shared/js/svgImageRender';

// SVG clip art without width/height was drawn cut off — see shared/js/svgImageRender.js.
installSvgImageRender(FabricImage);

const root = document.getElementById('pf-designer-root');
if (root) {
  createRoot(root).render(<App />);
}
