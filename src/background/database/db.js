/**
 * IndexedDB persistence wrapper.
 */

import { DB_NAME, DB_VERSION, OBJECT_STORES, upgradeDatabase } from './schema.js';

export class Database {
  constructor() {
    this.db = null;
    this.openPromise = null;
  }

  _hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
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
        console.warn('[DB] Open failed, resetting database and retrying:', error);
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
      console.log(`[DB] Opening database: ${DB_NAME} v${DB_VERSION}`);
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[DB] Failed to open database:', {
          name: request.error?.name,
          message: request.error?.message,
          error: request.error
        });
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[DB] Database opened successfully');
        console.log('[DB] Object stores:', Array.from(this.db.objectStoreNames));

        const requiredStores = Object.keys(OBJECT_STORES);
        const missingStores = requiredStores.filter(store => !this.db.objectStoreNames.contains(store));

        if (missingStores.length > 0) {
          console.error('[DB] Missing object stores:', missingStores);
          console.error('[DB] Database structure is invalid. Attempting recovery.');
          this.db.close();
          this.db = null;
          reject(new Error(`Missing object stores: ${missingStores.join(', ')}`));
          return;
        }

        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        console.log('[DB] onupgradeneeded triggered');
        const db = event.target.result;
        try {
          upgradeDatabase(db, event);
        } catch (error) {
          console.error('[DB] Error during upgrade:', error);
          reject(error);
        }
      };

      request.onblocked = () => {
        console.warn('[DB] Database upgrade blocked. Close all tabs using this database.');
      };
    });
  }

  async _resetDatabase() {
    this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);

      request.onsuccess = () => {
        console.warn('[DB] Database reset completed');
        resolve();
      };
      request.onerror = () => {
        console.error('[DB] Failed to reset database:', request.error);
        reject(request.error);
      };
      request.onblocked = () => {
        const error = new Error('Database reset blocked');
        console.error('[DB] Database reset blocked. Close other extension contexts and retry.');
        reject(error);
      };
    });
  }

  async saveConversation(conversation) {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.put(conversation);
      request.onsuccess = () => {
        console.log(`[DB] Conversation saved: ${conversation.id}`);
        resolve();
      };
      request.onerror = () => {
        console.error('[DB] Failed to save conversation:', request.error);
        reject(request.error);
      };
    });
  }

  async updateConversation(id, updates) {
    const existing = await this.getConversation(id);
    if (!existing) throw new Error(`Conversation not found: ${id}`);

    await this.saveConversation({ ...existing, ...updates });

    // Graph records are whole-conversation snapshots, not append-only logs.
    // Replace the old records so stale nodes cannot survive a canonical refresh.
    await this.replaceConversationGraphData(id, updates);
    console.log(`[DB] ✓ Conversation updated: ${id}`);
  }

  async replaceConversationGraphData(conversationId, data = {}) {
    const replacements = [
      { key: 'nodes', storeName: 'nodes', saver: items => this.saveNodes(items) },
      { key: 'edges', storeName: 'edges', saver: items => this.saveEdges(items) },
      { key: 'rounds', storeName: 'rounds', saver: items => this.saveRounds(items) },
      { key: 'branches', storeName: 'branches', saver: items => this.saveBranches(items) }
    ];

    for (const { key, storeName, saver } of replacements) {
      if (!this._hasOwn(data, key)) continue;

      const items = Array.isArray(data[key]) ? data[key] : [];
      await this.deleteRecordsByConversation(storeName, conversationId);

      if (items.length > 0) {
        await saver(items);
      } else {
        console.log(`[DB] Cleared ${storeName} for conversation: ${conversationId}`);
      }
    }
  }

  async deleteRecordsByConversation(storeName, conversationId) {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const index = store.index('conversationId');
      let deletedCount = 0;
      let settled = false;

      const finishError = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        if (deletedCount > 0) {
          console.log(`[DB] Deleted ${deletedCount} ${storeName} record(s) for conversation: ${conversationId}`);
        }
        resolve(deletedCount);
      };
      tx.onerror = () => finishError(tx.error || new Error(`Failed to delete ${storeName} records`));
      tx.onabort = () => finishError(tx.error || new Error(`Aborted deleting ${storeName} records`));

      const request = index.openCursor(IDBKeyRange.only(conversationId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        deletedCount += 1;
        cursor.continue();
      };
      request.onerror = () => finishError(request.error);
    });
  }

  async getConversation(id) {
    const db = await this.open();
    const tx = db.transaction('conversations', 'readonly');
    const store = tx.objectStore('conversations');

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveNodes(nodes) {
    const db = await this.open();
    const store = db.transaction('nodes', 'readwrite').objectStore('nodes');
    await Promise.all(nodes.map(node => new Promise((resolve, reject) => {
      const request = store.put(node);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    })));
    console.log(`[DB] Saved ${nodes.length} nodes`);
  }

  async getNodes(conversationId) {
    const db = await this.open();
    const index = db.transaction('nodes', 'readonly').objectStore('nodes').index('conversationId');
    return new Promise((resolve, reject) => {
      const request = index.getAll(conversationId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async saveEdges(edges) {
    const db = await this.open();
    const store = db.transaction('edges', 'readwrite').objectStore('edges');
    await Promise.all(edges.map(edge => new Promise((resolve, reject) => {
      const request = store.put(edge);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    })));
    console.log(`[DB] Saved ${edges.length} edges`);
  }

  async getEdges(conversationId) {
    const db = await this.open();
    const index = db.transaction('edges', 'readonly').objectStore('edges').index('conversationId');
    return new Promise((resolve, reject) => {
      const request = index.getAll(conversationId);
      request.onsuccess = () => {
        const edges = request.result || [];
        edges.sort((a, b) => (a.orderKey || 0) - (b.orderKey || 0));
        resolve(edges);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getRounds(conversationId) {
    const db = await this.open();
    const index = db.transaction('rounds', 'readonly').objectStore('rounds').index('conversationId');
    return new Promise((resolve, reject) => {
      const request = index.getAll(conversationId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async saveRounds(rounds) {
    const db = await this.open();
    const store = db.transaction('rounds', 'readwrite').objectStore('rounds');
    await Promise.all(rounds.map(round => new Promise((resolve, reject) => {
      const request = store.put(round);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    })));
    console.log(`[DB] Saved ${rounds.length} rounds`);
  }

  async saveBranches(branches) {
    const db = await this.open();
    const store = db.transaction('branches', 'readwrite').objectStore('branches');
    const withConversationId = branches.map(branch => ({
      ...branch,
      conversationId: branch.path[0]?.conversationId || 'unknown'
    }));

    await Promise.all(withConversationId.map(branch => new Promise((resolve, reject) => {
      const request = store.put(branch);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    })));
    console.log(`[DB] Saved ${branches.length} branches`);
  }

  async saveFullConversation(conversationData) {
    console.log(`[DB] Saving full conversation: ${conversationData.id}`);

    await this.saveConversation({
      id: conversationData.id,
      title: conversationData.title,
      createTime: conversationData.createTime,
      updateTime: conversationData.updateTime,
      nodeCount: conversationData.nodes?.length || 0,
      edgeCount: conversationData.edges?.length || 0,
      roundCount: conversationData.rounds?.length || 0,
      branchCount: conversationData.branches?.length || 0
    });

    await this.replaceConversationGraphData(conversationData.id, {
      nodes: conversationData.nodes,
      edges: conversationData.edges,
      rounds: conversationData.rounds,
      branches: conversationData.branches
    });

    console.log(`[DB] ✓ Full conversation saved: ${conversationData.id}`);
  }

  async getAllConversations() {
    const db = await this.open();
    const store = db.transaction('conversations', 'readonly').objectStore('conversations');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteConversation(conversationId) {
    const db = await this.open();

    await this.replaceConversationGraphData(conversationId, {
      nodes: [],
      edges: [],
      rounds: [],
      branches: []
    });

    const tx = db.transaction('conversations', 'readwrite');
    await new Promise((resolve, reject) => {
      const request = tx.objectStore('conversations').delete(conversationId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`[DB] Conversation deleted: ${conversationId}`);
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
    console.log('[DB] Database closed');
  }
}

export const db = new Database();
