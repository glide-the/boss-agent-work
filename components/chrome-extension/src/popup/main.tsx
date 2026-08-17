import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/popup.css';

const root = document.querySelector('#app');
if (!root) throw new Error('Popup root not found');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
