/**
 * Shared JSDoc type definitions.
 */

/**
 * @typedef {Object} ConversationNode
 * @property {string} id
 * @property {Object} message
 * @property {Object} message.author
 * @property {'user'|'assistant'|'system'} message.author.role
 * @property {Object} message.content
 * @property {string[]} message.content.parts
 * @property {number} message.create_time
 * @property {string|null} parent
 * @property {string[]} children
 */

/**
 * @typedef {Object} ParsedNode
 * @property {string} id
 * @property {string} conversationId
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 * @property {number} createTime
 * @property {string|null} parent
 * @property {string[]} children
 * @property {Object} metadata
 */

/**
 * @typedef {Object} Round
 * @property {string} id
 * @property {string} conversationId
 * @property {string} userMessageId
 * @property {string|null} assistantMessageId
 * @property {string|null} parentRoundId
 * @property {number} createTime
 */

/**
 * @typedef {Object} Branch
 * @property {string} id - Leaf node ID used as the branch ID.
 * @property {ParsedNode[]} path - Complete root-to-leaf path.
 * @property {number} messageCount
 * @property {number} depth
 */

/**
 * @typedef {Object} ConversationData
 * @property {string} id
 * @property {string} title
 * @property {number} createTime
 * @property {number} updateTime
 * @property {Object} mapping - Raw ChatGPT mapping.
 * @property {ParsedNode[]} nodes
 * @property {Round[]} rounds
 * @property {Branch[]} branches
 */

/**
 * @typedef {Object} BranchPoint
 * @property {string} nodeId
 * @property {'user'|'assistant'} role
 * @property {string} content
 * @property {number} childrenCount
 * @property {string[]} childrenIds
 */

/**
 * @typedef {Object} ExtensionMessage
 * @property {string} type
 * @property {Object} payload
 * @property {number} timestamp
 */

/**
 * @typedef {Object} APIResponse
 * @property {boolean} success
 * @property {Object} [data]
 * @property {string} [error]
 */

export default {};
