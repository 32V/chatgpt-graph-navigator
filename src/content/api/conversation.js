/**
 * ChatGPT conversation API client.
 */

import { API_ENDPOINTS } from '../../shared/constants.js';
import { delay, log, retry } from '../../shared/utils.js';
import { buildAuthHeaders, clearAuthCache } from '../auth/token-manager.js';

async function fetchConversation(conversationId, isRetry = false) {
  log('info', 'API', `Fetching conversation: ${conversationId}${isRetry ? ' (retry)' : ''}`);

  try {
    const response = await fetch(`${API_ENDPOINTS.CONVERSATION}/${conversationId}`, {
      method: 'GET',
      credentials: 'include',
      headers: buildAuthHeaders()
    });

    if (!response.ok) {
      let errorDetail = '';
      let errorData = null;

      try {
        errorData = await response.json();
        errorDetail = JSON.stringify(errorData);
      } catch {
        errorDetail = await response.text();
      }

      if (response.status === 401) {
        log('warn', 'API', 'Authentication failed (401), clearing auth cache');
        clearAuthCache();

        if (!isRetry) {
          log('info', 'API', 'Retrying with fresh auth info...');
          await delay(500);
          return fetchConversation(conversationId, true);
        }

        throw new Error('Authentication failed (401). Make sure you are signed in to ChatGPT and refresh the page.');
      }

      if (response.status === 404 && errorData?.detail?.code === 'conversation_not_found') {
        log('warn', 'API', `Conversation not found: ${conversationId}`);
        throw new Error('Conversation not found (404). Open a valid ChatGPT conversation page.');
      }

      log('error', 'API', `HTTP ${response.status}:`, errorDetail);
      throw new Error(`API Error: ${response.status} - ${errorDetail}`);
    }

    const data = await response.json();
    log('info', 'API', 'Conversation loaded successfully', {
      id: data.id || conversationId,
      title: data.title,
      mappingSize: Object.keys(data.mapping || {}).length
    });
    return data;
  } catch (error) {
    log('error', 'API', 'Failed to fetch conversation:', error);
    throw error;
  }
}

export async function fetchConversationWithRetry(conversationId, maxRetries = 3) {
  return retry(() => fetchConversation(conversationId), maxRetries, 1000);
}

export async function checkAPIAvailability() {
  try {
    const response = await fetch(API_ENDPOINTS.ME, { credentials: 'include' });
    return response.ok;
  } catch (error) {
    log('warn', 'API', 'API availability check failed:', error);
    return false;
  }
}
