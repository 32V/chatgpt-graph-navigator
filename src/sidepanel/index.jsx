/**
 * Side Panel React 入口
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { STORAGE_KEYS } from '../shared/constants';

const container = document.getElementById('root');
const root = createRoot(container);

const IS_EMBEDDED = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('embedded')) {
      document.documentElement.classList.add('embedded');
      const initialTheme = params.get('theme');
      if (initialTheme === 'dark' || initialTheme === 'light') {
        document.documentElement.dataset.cgTheme = initialTheme;
      }
      return true;
    }
  } catch {
    // ignore
  }
  return false;
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
    // ignore
  }
}

/**
 * Apply sidepanel UI zoom (CSS zoom). This is independent from webpage zoom.
 * Embedded mode follows the ChatGPT dock size directly, so zoom is not applied.
 */
(() => {
  if (IS_EMBEDDED) return;

  const clampZoom = (v) => {
    const z = Number(v);
    if (!Number.isFinite(z)) return 1;
    return Math.max(0.5, Math.min(2.5, z));
  };

  const applyZoom = (z) => {
    document.documentElement.style.zoom = String(clampZoom(z));
  };

  try {
    chrome.storage.local.get(STORAGE_KEYS.SIDEPANEL_UI_ZOOM).then((res) => {
      applyZoom(res?.[STORAGE_KEYS.SIDEPANEL_UI_ZOOM] ?? 1);
    });
  } catch {
    // ignore
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes?.[STORAGE_KEYS.SIDEPANEL_UI_ZOOM]) return;
      applyZoom(changes[STORAGE_KEYS.SIDEPANEL_UI_ZOOM].newValue ?? 1);
    });
  } catch {
    // ignore
  }
})();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
