/**
 * ChatGPT canonical conversation API client.
 */

import { API_ENDPOINTS } from '../../shared/constants.js';
import { delay, log, retry } from '../../shared/utils.js';
import { buildAuthHeaders, clearAuthCache } from '../auth/token-manager.js';

async function fetchConversation(conversationId, isAuthRetry = false) {
  const response = await fetch(`${API_ENDPOINTS.CONVERSATION}/${conversationId}`, {
    method: 'GET',
    credentials: 'include',
    headers: buildAuthHeaders()
  });

  if (response.ok) return response.json();

  let errorDetail = '';
  let errorData = null;
  try {
    errorData = await response.json();
    errorDetail = JSON.stringify(errorData);
  } catch {
    errorDetail = await response.text();
  }

  if (response.status === 401) {
    clearAuthCache();
    if (!isAuthRetry) {
      await delay(500);
      return fetchConversation(conversationId, true);
    }
    throw new Error('Authentication failed (401). Sign in to ChatGPT and refresh the page.');
  }

  if (response.status === 404 && errorData?.detail?.code === 'conversation_not_found') {
    throw new Error('Conversation not found (404). Open a valid ChatGPT conversation.');
  }

  log('error', 'API', `HTTP ${response.status}:`, errorDetail);
  throw new Error(`ChatGPT API error ${response.status}: ${errorDetail}`);
}

export function fetchConversationWithRetry(conversationId, maxRetries = 3) {
  return retry(() => fetchConversation(conversationId), maxRetries, 1000);
}
