/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_Session.js
 *
 * Session management for Frontend-Orchestrated Agent Loop.
 * Uses N/cache to store conversation state between requests.
 *
 * ARCHITECTURE:
 * - Each conversation gets a unique session ID
 * - Session stores: messages, pending tool calls, state
 * - Frontend makes multiple short requests, each advancing the state
 * - This enables "streaming" via multiple fast requests instead of one slow one
 */
define([
    'N/cache',
    'N/log',
    'N/crypto'
], function(cache, log, crypto) {
    'use strict';

    // Cache configuration
    const CACHE_NAME = 'ADVISOR_SESSIONS';
    const CACHE_SCOPE = cache.Scope.PRIVATE; // User-specific sessions
    const SESSION_TTL = 900; // 15 minutes

    /**
     * Get or create the session cache
     */
    function getSessionCache() {
        return cache.getCache({
            name: CACHE_NAME,
            scope: CACHE_SCOPE
        });
    }

    /**
     * Generate a unique session ID
     */
    function generateSessionId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        return 'adv_' + timestamp + '_' + random;
    }

    /**
     * Create a new session
     * @param {string} userQuery - The initial user question
     * @returns {Object} - Session object with ID
     */
    function createSession(userQuery) {
        const sessionId = generateSessionId();

        const session = {
            id: sessionId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            state: 'initialized', // initialized, thinking, tool_pending, tool_running, synthesizing, complete, error
            userQuery: userQuery,

            // Conversation history for LLM
            messages: [
                { role: 'user', content: userQuery }
            ],

            // Tool execution tracking
            pendingToolCalls: [], // Tools the LLM wants to call
            executedTools: [], // Tools we've already called with results
            currentToolIndex: 0,

            // Results
            intermediateResults: [], // For showing progress
            finalAnswer: null,

            // Iteration tracking
            iteration: 0,
            maxIterations: 10
        };

        // Store in cache
        const sessionCache = getSessionCache();
        sessionCache.put({
            key: sessionId,
            value: JSON.stringify(session),
            ttl: SESSION_TTL
        });

        log.debug('Session Created', { sessionId: sessionId, query: userQuery });

        return session;
    }

    /**
     * Get an existing session
     * @param {string} sessionId
     * @returns {Object|null} - Session object or null if not found
     */
    function getSession(sessionId) {
        if (!sessionId) return null;

        try {
            const sessionCache = getSessionCache();
            const cached = sessionCache.get({
                key: sessionId
            });

            if (!cached) {
                log.debug('Session Not Found', { sessionId: sessionId });
                return null;
            }

            return JSON.parse(cached);
        } catch (e) {
            log.error('Session Get Error', { sessionId: sessionId, error: e.message });
            return null;
        }
    }

    /**
     * Update a session
     * @param {Object} session - The session object to save
     */
    function updateSession(session) {
        if (!session || !session.id) {
            throw new Error('Invalid session object');
        }

        session.updatedAt = Date.now();

        const sessionCache = getSessionCache();
        sessionCache.put({
            key: session.id,
            value: JSON.stringify(session),
            ttl: SESSION_TTL
        });

        log.debug('Session Updated', {
            sessionId: session.id,
            state: session.state,
            iteration: session.iteration
        });
    }

    /**
     * Delete a session
     * @param {string} sessionId
     */
    function deleteSession(sessionId) {
        if (!sessionId) return;

        try {
            const sessionCache = getSessionCache();
            sessionCache.remove({
                key: sessionId
            });
            log.debug('Session Deleted', { sessionId: sessionId });
        } catch (e) {
            log.error('Session Delete Error', { sessionId: sessionId, error: e.message });
        }
    }

    /**
     * Add a message to the session's conversation
     * @param {Object} session
     * @param {string} role - 'user', 'assistant', or 'tool'
     * @param {string} content
     */
    function addMessage(session, role, content) {
        session.messages.push({
            role: role,
            content: content,
            timestamp: Date.now()
        });
    }

    /**
     * Add an intermediate result for progress display
     * @param {Object} session
     * @param {string} type - 'thinking', 'tool_call', 'tool_result', 'synthesizing'
     * @param {Object} data - Result data
     */
    function addIntermediateResult(session, type, data) {
        session.intermediateResults.push({
            type: type,
            data: data,
            timestamp: Date.now()
        });
    }

    /**
     * Set pending tool calls from LLM response
     * @param {Object} session
     * @param {Array} toolCalls - Array of tool call objects
     */
    function setPendingToolCalls(session, toolCalls) {
        session.pendingToolCalls = toolCalls || [];
        session.currentToolIndex = 0;
        if (toolCalls && toolCalls.length > 0) {
            session.state = 'tool_pending';
        }
    }

    /**
     * Get the next pending tool call
     * @param {Object} session
     * @returns {Object|null} - Next tool call or null if none
     */
    function getNextPendingTool(session) {
        if (!session.pendingToolCalls || session.currentToolIndex >= session.pendingToolCalls.length) {
            return null;
        }
        return session.pendingToolCalls[session.currentToolIndex];
    }

    /**
     * Mark current tool as executed and store result
     * @param {Object} session
     * @param {Object} result - Tool execution result
     */
    function markToolExecuted(session, toolCall, result) {
        session.executedTools.push({
            tool: toolCall,
            result: result,
            timestamp: Date.now()
        });
        session.currentToolIndex++;

        // Check if all tools are done
        if (session.currentToolIndex >= session.pendingToolCalls.length) {
            session.state = 'tools_complete';
        }
    }

    /**
     * Check if session has more tools to execute
     * @param {Object} session
     * @returns {boolean}
     */
    function hasMoreTools(session) {
        return session.pendingToolCalls &&
               session.currentToolIndex < session.pendingToolCalls.length;
    }

    /**
     * Build conversation context string for LLM
     * @param {Object} session
     * @returns {string}
     */
    function buildConversationContext(session) {
        let context = '';

        // Add messages
        for (const msg of session.messages) {
            if (msg.role === 'user') {
                context += '\n\nUser: ' + msg.content;
            } else if (msg.role === 'assistant') {
                context += '\n\nAssistant: ' + msg.content;
            } else if (msg.role === 'tool') {
                context += '\n\n[Tool Result]: ' + msg.content;
            }
        }

        // Add executed tool results
        if (session.executedTools && session.executedTools.length > 0) {
            context += '\n\n--- Tool Execution Results ---';
            for (const executed of session.executedTools) {
                context += '\n\nTool: ' + executed.tool.name;
                context += '\nArguments: ' + JSON.stringify(executed.tool.arguments);
                context += '\nResult: ' + JSON.stringify(executed.result);
            }
        }

        return context;
    }

    return {
        createSession: createSession,
        getSession: getSession,
        updateSession: updateSession,
        deleteSession: deleteSession,
        addMessage: addMessage,
        addIntermediateResult: addIntermediateResult,
        setPendingToolCalls: setPendingToolCalls,
        getNextPendingTool: getNextPendingTool,
        markToolExecuted: markToolExecuted,
        hasMoreTools: hasMoreTools,
        buildConversationContext: buildConversationContext
    };
});
