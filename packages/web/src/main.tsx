import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { initOffline } from './offline/store.js';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

initOffline();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
