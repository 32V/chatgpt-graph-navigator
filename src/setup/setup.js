/**
 * Optional manual ChatGPT access-token setup.
 */

const tokenInput = document.getElementById('token-input');
const testBtn = document.getElementById('test-btn');
const saveBtn = document.getElementById('save-btn');
const alertContainer = document.getElementById('alert-container');

let validatedToken = null;

function showAlert(type, message) {
  alertContainer.textContent = '';
  const alert = document.createElement('div');
  alert.className = `alert ${type}`;
  alert.textContent = message;
  alertContainer.appendChild(alert);
}

function clearAlert() {
  alertContainer.textContent = '';
}

function normalizeAndValidateToken(input) {
  let token = input.trim();
  if (token.startsWith('Bearer ')) token = token.slice(7).trim();

  if (!token) return { valid: false, error: 'Enter an access token.' };
  if (token.length < 100) return { valid: false, error: 'The token is too short. Copy the complete token.' };
  if (!token.startsWith('eyJ') || token.split('.').length !== 3) {
    return { valid: false, error: 'This does not look like a ChatGPT JWT access token.' };
  }

  return { valid: true, token };
}

async function checkExistingToken() {
  try {
    const result = await chrome.storage.local.get(['accessToken', 'tokenTimestamp']);
    if (!result.accessToken) return;

    const age = Date.now() - (result.tokenTimestamp || 0);
    if (age < 24 * 60 * 60 * 1000) {
      showAlert('success', 'A valid token is already stored. Enter a new one only if you want to replace it.');
      tokenInput.placeholder = 'Paste a new token to replace the stored token';
    } else {
      showAlert('warning', 'The stored token is expired. Paste a fresh token below.');
    }
  } catch (error) {
    console.error('Failed to inspect the stored token:', error);
  }
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

    if (response.ok) return { valid: true };
    if (response.status === 401) {
      return { valid: false, error: 'The token is invalid or expired.' };
    }
    return { valid: false, error: `ChatGPT returned HTTP ${response.status}.` };
  } catch (error) {
    return { valid: false, error: `Network error: ${error.message}` };
  }
}

testBtn.addEventListener('click', async () => {
  clearAlert();
  const format = normalizeAndValidateToken(tokenInput.value);
  if (!format.valid) {
    showAlert('error', format.error);
    return;
  }

  testBtn.disabled = true;
  testBtn.innerHTML = '<span class="loading"></span>Testing...';
  const result = await testToken(format.token);
  testBtn.disabled = false;
  testBtn.textContent = 'Test token';

  if (result.valid) {
    validatedToken = format.token;
    saveBtn.disabled = false;
    showAlert('success', 'Token validated successfully.');
  } else {
    validatedToken = null;
    saveBtn.disabled = true;
    showAlert('error', result.error);
  }
});

saveBtn.addEventListener('click', async () => {
  if (!validatedToken) {
    showAlert('error', 'Test the token successfully before saving it.');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="loading"></span>Saving...';

  try {
    await chrome.storage.local.set({
      accessToken: validatedToken,
      tokenTimestamp: Date.now(),
      tokenSource: 'manual'
    });
    showAlert('success', 'Token saved. You can close this page.');
    saveBtn.textContent = 'Saved';
  } catch (error) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    showAlert('error', `Could not save the token: ${error.message}`);
  }
});

tokenInput.addEventListener('input', () => {
  clearAlert();
  validatedToken = null;
  saveBtn.disabled = true;
});

checkExistingToken();
