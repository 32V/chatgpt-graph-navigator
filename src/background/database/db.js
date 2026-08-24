/**
 * IndexedDB persistence for canonical conversation graphs.
 */

import { DB_NAME, DB_VERSION, OBJECT_STORES, upgradeDatabase } from './schema.js';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

function deleteConversationRecords(store, conversationId, onComplete) {
  const request = store.index('conversationId').openCursor(IDBKeyRange.only(conversationId));
  request.onsuccess = (event) => {
    const cursor = event.target.result;
    if (!cursor) {
      onComplete();
      return;
    }
    cursor.delete();
    cursor.continue();
  };
}

export class Database {
  constructor() {
    this.db = null;
    this.openPromise = null;
  }

  async open() {
    if (this.db) return this.db;
    if (!this.openPromise) {
      this.openPromise = this._openWithRecovery().finally(() => {
        this.openPromise = null;
      });
    }
    return this.openPromise;
  }

  async _openWithRecovery(hasRetried = false) {
    try {
      return await this._openDatabase();
    } catch (error) {
      if (!hasRetried && this._shouldResetDatabase(error)) {
        await this._resetDatabase();
        return this._openWithRecovery(true);
      }
      throw error;
    }
  }

  _shouldResetDatabase(error) {
    const message = error?.message || '';
    return (
      message.includes('Missing object stores') ||
      error?.name === 'VersionError' ||
      error?.name === 'InvalidStateError' ||
      error?.name === 'NotFoundError'
    );
  }

  _openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        try {
          upgradeDatabase(event.target.result);
        } catch (error) {
          reject(error);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        const missingStores = Object.keys(OBJECT_STORES)
          .filter(storeName => !this.db.objectStoreNames.contains(storeName));

        if (missingStores.length > 0) {
          this.db.close();
          this.db = null;
          reject(new Error(`Missing object stores: ${missingStores.join(', ')}`));
          return;
        }

        resolve(this.db);
      };

      request.onerror = () => reject(request.error);
      request.onblocked = () => console.warn('[DB] Upgrade blocked by another extension context');
    });
  }

  async _resetDatabase() {
    this.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Database reset blocked'));
    });
  }

  async getConversation(id) {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readonly');
    return (await requestResult(tx.objectStore('conversations').get(id))) || null;
  }

  async getNodes(conversationId) {
    const db = await this.open();
    const tx = db.transaction('nodes', 'readonly');
    const index = tx.objectStore('nodes').index('conversationId');
    return (await requestResult(index.getAll(conversationId))) || [];
  }

  async getEdges(conversationId) {
    const db = await this.open();
    const tx = db.transaction('edges', 'readonly');
    const index = tx.objectStore('edges').index('conversationId');
    const edges = (await requestResult(index.getAll(conversationId))) || [];
    return edges.sort((a, b) => (a.orderKey || 0) - (b.orderKey || 0));
  }

  async saveFullConversation(conversationData) {
    const db = await this.open();
    const conversationId = conversationData.id;
    const tx = db.transaction(['conversations', 'nodes', 'edges'], 'readwrite');
    const conversationStore = tx.objectStore('conversations');
    const nodeStore = tx.objectStore('nodes');
    const edgeStore = tx.objectStore('edges');

    let clearedStores = 0;
    const publishSnapshot = () => {
      clearedStores += 1;
      if (clearedStores !== 2) return;

      for (const node of conversationData.nodes || []) nodeStore.put(node);
      for (const edge of conversationData.edges || []) edgeStore.put(edge);
      conversationStore.put({
        id: conversationId,
        title: conversationData.title,
        createTime: conversationData.createTime,
        updateTime: conversationData.updateTime,
        currentNodeId: conversationData.currentNodeId || null,
        nodeCount: conversationData.nodes?.length || 0,
        edgeCount: conversationData.edges?.length || 0
      });
    };

    // Cursor requests keep the transaction active. Once both old payload stores
    // are cleared, queue the complete replacement snapshot synchronously in the
    // same transaction so readers can observe only the old or the new version.
    deleteConversationRecords(nodeStore, conversationId, publishSnapshot);
    deleteConversationRecords(edgeStore, conversationId, publishSnapshot);
    await transactionDone(tx);
  }

  close() {
    this.db?.close();
    this.db = null;
  }
}

export const db = new Database();
