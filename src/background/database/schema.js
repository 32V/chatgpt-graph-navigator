/**
 * IndexedDB schema for persisted canonical conversation graphs.
 */

export const DB_NAME = 'ChatGPTGraphDB';
export const DB_VERSION = 6;

export const OBJECT_STORES = {
  conversations: {
    keyPath: 'id',
    indexes: [
      { name: 'updateTime', keyPath: 'updateTime', unique: false },
      { name: 'createTime', keyPath: 'createTime', unique: false }
    ]
  },
  nodes: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'role', keyPath: 'role', unique: false },
      { name: 'createTime', keyPath: 'createTime', unique: false }
    ]
  },
  edges: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'source', keyPath: 'source', unique: false },
      { name: 'target', keyPath: 'target', unique: false },
      { name: 'orderKey', keyPath: 'orderKey', unique: false }
    ]
  }
};

const DEPRECATED_STORES = ['rounds', 'branches', 'conversation_backups'];

/**
 * Upgrade the database without touching the canonical stores when they already
 * exist. Version 6 removes derived/legacy stores that are no longer read by the
 * product; graph views are rebuilt from nodes and edges instead.
 */
export function upgradeDatabase(db) {
  for (const storeName of DEPRECATED_STORES) {
    if (db.objectStoreNames.contains(storeName)) {
      db.deleteObjectStore(storeName);
    }
  }

  for (const [storeName, config] of Object.entries(OBJECT_STORES)) {
    if (db.objectStoreNames.contains(storeName)) continue;

    const store = db.createObjectStore(storeName, { keyPath: config.keyPath });
    for (const index of config.indexes || []) {
      store.createIndex(index.name, index.keyPath, { unique: index.unique });
    }
  }
}
