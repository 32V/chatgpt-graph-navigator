/**
 * IndexedDB schema definition.
 */

export const DB_NAME = 'ChatGPTGraphDB';
// Keep the hotfix branch forward-compatible with the backup feature branch.
// The browser may already contain a v5 database with the backup store.
export const DB_VERSION = 5;

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

  // Parent/child relationships between parsed nodes.
  edges: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'source', keyPath: 'source', unique: false },
      { name: 'target', keyPath: 'target', unique: false },
      { name: 'orderKey', keyPath: 'orderKey', unique: false }
    ]
  },

  rounds: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false },
      { name: 'createTime', keyPath: 'createTime', unique: false }
    ]
  },

  branches: {
    keyPath: 'id',
    indexes: [
      { name: 'conversationId', keyPath: 'conversationId', unique: false }
    ]
  },

  // Raw API snapshots used by the optional backup path.
  conversation_backups: {
    keyPath: 'conversation_id',
    indexes: [
      { name: 'title', keyPath: 'title', unique: false },
      { name: 'create_time', keyPath: 'create_time', unique: false },
      { name: 'update_time', keyPath: 'update_time', unique: false },
      { name: 'backup_time', keyPath: 'backup_time', unique: false }
    ]
  }
};

/**
 * Create any object stores that are missing during an IndexedDB upgrade.
 */
export function upgradeDatabase(db, event) {
  const oldVersion = event.oldVersion;
  const newVersion = event.newVersion;

  console.log(`[DB] Upgrading database from v${oldVersion} to v${newVersion}`);
  console.log('[DB] Existing object stores:', Array.from(db.objectStoreNames));

  try {
    for (const [storeName, config] of Object.entries(OBJECT_STORES)) {
      if (db.objectStoreNames.contains(storeName)) {
        console.log(`[DB] Object store already exists: ${storeName}`);
        continue;
      }

      console.log(`[DB] Creating object store: ${storeName}`);
      const store = db.createObjectStore(storeName, { keyPath: config.keyPath });

      for (const index of config.indexes || []) {
        console.log(`[DB]   Creating index: ${index.name}`);
        store.createIndex(index.name, index.keyPath, { unique: index.unique });
      }

      console.log(`[DB] ✓ Created object store: ${storeName}`);
    }

    console.log('[DB] ✓ Database upgrade completed');
  } catch (error) {
    console.error('[DB] Error during database upgrade:', error);
    throw error;
  }
}
