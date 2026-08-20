/**
 * ChatGPT Graph Extension - setup page.
 */

import { initI18n, i18n } from '../shared/i18n.js';

const tokenInput = document.getElementById('token-input');
const testBtn = document.getElementById('test-btn');
const saveBtn = document.getElementById('save-btn');
const alertContainer = document.getElementById('alert-container');

let validatedToken = null;

async function checkExistingToken() {
  try {
    const result = await chrome.storage.local.get(['accessToken', 'tokenTimestamp']);
    if (!result.accessToken) return;

    const age = Date.now() - (result.tokenTimestamp || 0);
    const expired = age > 24 * 60 * 60 * 1000;

    if (!expired) {
      showAlert('success', i18n('tokenAlreadyConfigured'));
      tokenInput.placeholder = i18n('newTokenPlaceholder');
    } else {
      showAlert('warning', i18n('tokenExpiredPleaseUpdate'));
    }
  } catch (error) {
    console.error('Failed to check existing token:', error);
  }
}

function showAlert(type, message) {
  alertContainer.innerHTML = `<div class="alert ${type}">${message}</div>`;
}

function clearAlert() {
  alertContainer.innerHTML = '';
}

function validateTokenFormat(token) {
  token = token.trim();

  if (token.startsWith('Bearer ')) {
    token = token.substring(7);
  }

  if (!token) {
    return { valid: false, error: i18n('tokenEmpty') };
  }

  if (token.length < 100) {
    return { valid: false, error: i18n('tokenTooShort') };
  }

  // ChatGPT access tokens are JWTs and normally begin with the base64-encoded
  // JSON header prefix `eyJ`.
  if (!token.startsWith('eyJ')) {
    return { valid: false, error: i18n('tokenInvalidFormat') };
  }

  if (token.split('.').length !== 3) {
    return { valid: false, error: i18n('tokenInvalidJWT') };
  }

  return { valid: true, token };
}

async function testToken(token) {
  try {
    const response = await fetch('https://chatgpt.com/backend-api/me', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: '*/*'
      }
    });

    if (response.ok) {
      return { valid: true, data: await response.json() };
    }

    if (response.status === 401) {
      return { valid: false, error: i18n('tokenInvalidOrExpired') };
    }

    return {
      valid: false,
      error: i18n('apiError', response.status.toString())
    };
  } catch (error) {
    return {
      valid: false,
      error: i18n('networkError', error.message)
    };
  }
}

testBtn.addEventListener('click', async () => {
  clearAlert();

  const formatCheck = validateTokenFormat(tokenInput.value);
  if (!formatCheck.valid) {
    showAlert('error', `❌ ${formatCheck.error}`);
    return;
  }

  const token = formatCheck.token;
  testBtn.disabled = true;
  testBtn.innerHTML = `<span class="loading"></span>${i18n('testingToken')}`;

  const result = await testToken(token);

  testBtn.disabled = false;
  testBtn.textContent = i18n('testTokenBtn');

  if (result.valid) {
    validatedToken = token;
    const account = result.data.email || result.data.name || i18n('accountUnknown');
    showAlert('success', i18n('tokenValidationSuccess', account));
    saveBtn.disabled = false;
  } else {
    validatedToken = null;
    saveBtn.disabled = true;
    showAlert('error', `❌ ${result.error}`);
  }
});

saveBtn.addEventListener('click', async () => {
  if (!validatedToken) {
    showAlert('error', `❌ ${i18n('pleaseTestFirst')}`);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="loading"></span>${i18n('savingToken')}`;

  try {
    await chrome.storage.local.set({
      accessToken: validatedToken,
      tokenTimestamp: Date.now(),
      tokenSource: 'manual'
    });

    showAlert('success', i18n('tokenSaved'));
    setTimeout(() => window.close(), 1000);
  } catch (error) {
    saveBtn.disabled = false;
    saveBtn.textContent = i18n('saveCompleteBtn');
    showAlert('error', `❌ ${i18n('saveFailed', error.message)}`);
  }
});

tokenInput.addEventListener('input', () => {
  clearAlert();
  validatedToken = null;
  saveBtn.disabled = true;
});

document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();
  await checkExistingToken();
});
