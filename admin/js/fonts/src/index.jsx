import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './fonts.css';

const el = document.getElementById('pf-fonts-app');
if (el) {
  createRoot(el).render(<App />);
}
