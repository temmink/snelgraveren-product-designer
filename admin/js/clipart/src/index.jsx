import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './clipart.css';

const el = document.getElementById('pf-clipart-app');
if (el) {
  createRoot(el).render(<App />);
}
