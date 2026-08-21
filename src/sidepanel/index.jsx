import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
const root = createRoot(container);

const IS_EMBEDDED = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('embedded')) return false;

    document.documentElement.classList.add('embedded');
    const initialTheme = params.get('theme');
    if (initialTheme === 'dark' || initialTheme === 'light') {
      document.documentElement.dataset.cgTheme = initialTheme;
    }
    return true;
  } catch {
    return false;
  }
})();

function applyHostTheme(payload = {}) {
  const mode = payload.mode === 'dark' ? 'dark' : 'light';
  const background = String(payload.background || '').trim();
  const foreground = String(payload.foreground || '').trim();

  document.documentElement.dataset.cgTheme = mode;
  if (background) document.documentElement.style.setProperty('--cg-bg', background);
  if (foreground) document.documentElement.style.setProperty('--cg-text', foreground);
}

if (IS_EMBEDDED) {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (event?.data?.type === 'CG_THEME') {
      applyHostTheme(event.data.payload || {});
    }
  });

  try {
    window.parent?.postMessage({ type: 'CG_THEME_REQUEST' }, '*');
  } catch {
    // Parent may not be ready during the first microtask.
  }
}

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
