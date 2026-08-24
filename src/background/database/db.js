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

function validateDatabaseSchema(database) {
  for (const [storeName, config] of Object.entries(OBJECT_STORES)) {
    if (!database.objectStoreNames.contains(storeName)) {
      throw new Error(`Schema mismatch: missing object store ${storeName}`);
    }

    const tx = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    if (store.keyPath !== config.keyPath) {
      throw new Error(
        `Schema mismatch: ${storeName} keyPath is ${String(store.keyPath)}, expected ${config.keyPath}`
      );
    }

    for (const indexConfig of config.indexes || []) {
      if (!store.indexNames.contains(indexConfig.name)) {
        throw new Error(`Schema mismatch: ${storeName} is missing index ${indexConfig.name}`);
      }

      const index = store.index(indexConfig.name);
      if (index.keyPath !== indexConfig.keyPath || index.unique !== indexConfig.unique) {
        throw new Error(`Schema mismatch: ${storeName}.${indexConfig.name} has incompatible definition`);
      }
    }
  }
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
      message.includes('Schema mismatch') ||
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

        try {
          validateDatabaseSchema(this.db);
        } catch (error) {
          this.db.close();
          this.db = null;
          reject(error);
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

  async getFullConversation(conversationId) {
    const db = await this.open();
    const tx = db.transaction(['conversations', 'nodes', 'edges'], 'readonly');
    const done = transactionDone(tx);

    const conversationRequest = tx.objectStore('conversations').get(conversationId);
    const nodeRequest = tx.objectStore('nodes').index('conversationId').getAll(conversationId);
    const edgeRequest = tx.objectStore('edges').index('conversationId').getAll(conversationId);

    const [conversation, nodes, edges] = await Promise.all([
      requestResult(conversationRequest),
      requestResult(nodeRequest),
      requestResult(edgeRequest)
    ]);
    await done;

    if (!conversation) return null;
    return {
      conversation,
      nodes: nodes || [],
      edges: (edges || []).sort((a, b) => (a.orderKey || 0) - (b.orderKey || 0))
    };
  }

  async saveFullConversation(conversationData) {
    const db = await this.open();
    const conversationId = conversationData.id;
    const tx = db.transaction(['conversations', 'nodes', 'edges'], 'readwrite');
    const done = transactionDone(tx);
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
    await done;
  }

  close() {
    this.db?.close();
    this.db = null;
  }
}

export const db = new Database();
