/**
 * English-only localization helpers.
 *
 * The extension ships a single `_locales/en/messages.json` catalog and relies on
 * Chrome's built-in i18n lookup. Keeping this wrapper preserves the existing
 * `data-i18n` markup without maintaining a redundant runtime locale system.
 */

/**
 * Resolve a message from the bundled English catalog.
 *
 * @param {string} key
 * @param {string|string[]} [substitutions]
 * @returns {string}
 */
export function i18n(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * Apply localized text to the current document.
 *
 * The function remains async-compatible with existing callers even though no
 * locale file needs to be fetched at runtime anymore.
 *
 * @returns {Promise<void>}
 */
export async function initI18n() {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    const text = i18n(key);
    if (text.includes('<')) element.innerHTML = text;
    else element.textContent = text;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    const key = element.getAttribute('data-i18n-placeholder');
    element.placeholder = i18n(key);
  });

  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    const key = element.getAttribute('data-i18n-title');
    element.title = i18n(key);
  });

  const titleKey = document.documentElement.getAttribute('data-i18n-title');
  if (titleKey) document.title = i18n(titleKey);

  document.documentElement.lang = 'en';
}
