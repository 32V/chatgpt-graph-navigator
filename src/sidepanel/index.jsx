import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const params = new URLSearchParams(window.location.search);
const initialTheme = params.get('theme');
if (initialTheme === 'dark' || initialTheme === 'light') {
  document.documentElement.dataset.cgTheme = initialTheme;
}

function applyHostTheme(payload = {}) {
  const mode = payload.mode === 'dark' ? 'dark' : 'light';
  const background = String(payload.background || '').trim();
  const foreground = String(payload.foreground || '').trim();

  document.documentElement.dataset.cgTheme = mode;
  if (background) document.documentElement.style.setProperty('--cg-bg', background);
  if (foreground) document.documentElement.style.setProperty('--cg-text', foreground);
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (event?.data?.type === 'CG_THEME') {
    applyHostTheme(event.data.payload || {});
  }
});

try {
  window.parent?.postMessage({ type: 'CG_THEME_REQUEST' }, '*');
} catch {
  // The dock will send the theme again when the frame reports readiness.
}

const container = document.getElementById('root');
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
