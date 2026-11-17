import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './builder.css';

const root = document.getElementById('pf-template-builder-root');
if (root) {
  createRoot(root).render(<App />);
}
