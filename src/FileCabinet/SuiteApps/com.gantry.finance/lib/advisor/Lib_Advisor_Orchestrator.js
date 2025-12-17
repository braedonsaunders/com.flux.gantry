/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_Orchestrator.js
 * Main orchestration for LLM-powered financial advisor
 *
 * ARCHITECTURE:
 * - Streaming Context Architecture (SCA) for fast, lightweight LLM calls
 * - Progressive rendering via polling
 *
 * FLOW:
 * 1. processChatAsync() - Returns request_id immediately, use polling for updates
 * 2. getStatus() - Poll for progress updates, each poll advances one phase
 */
define([
    'N/log',
    './Lib_Advisor_StreamingAgent',
    './Lib_Advisor_Cache',
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_Utils',
    './Lib_Advisor_Tools'
], function(
    log,
    StreamingAgent,
    Cache,
    AIProviders,
    Utils,
    Tools
) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // ASYNC ENTRY POINT - For Progressive Rendering
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Start processing a chat message asynchronously with step-by-step execution.
     * Returns request_id immediately. Use getStatus() to poll for updates.
     * Each getStatus() call advances the agent one step for progressive rendering.
     *
     * @param {Object} params - Chat parameters
     * @returns {Object} { request_id, status: 'processing' }
     */
    function processChatAsync(params) {
        const message = params.message || '';
        const history = params.history || [];
        const sessionContext = params.sessionContext || {};
        const aiSettings = params.aiSettings || {};

        // Generate request ID
        const requestId = Cache.generateRequestId();

        // Enable debug mode if requested
        Utils.resetDebugModeCache();
        if (aiSettings.debugMode === true) {
            Utils.setForceDebugMode(true);
        }

        Utils.debugLog('ProcessChatAsync starting', {
            requestId: requestId,
            messageLength: message.length
        });

        try {
            // Initialize Streaming Agent
            const agentState = StreamingAgent.initState(message, sessionContext, requestId, history);

            // Create progress entry
            Cache.create(requestId, message, agentState);

            Utils.debugLog('ProcessChatAsync returning immediately', {
                requestId: requestId,
                provider: aiSettings.provider || 'default'
            });

            return {
                request_id: requestId,
                status: 'processing'
            };

        } catch (e) {
            log.error('ProcessChatAsync Error', {
                requestId: requestId,
                error: e.message,
                stack: e.stack,
                phase: 'initialization'
            });

            // Ensure cache entry exists even on error so polling doesn't return not_found
            try {
                Cache.fail(requestId, e.message);
            } catch (cacheError) {
                log.error('Failed to store error state in cache', {
                    requestId: requestId,
                    originalError: e.message,
                    cacheError: cacheError.message
                });
            }

            return {
                request_id: requestId,
                status: 'error',
                error: e.message
            };
        }
    }

    /**
     * Get status of an async request and advance the agent if still processing.
     * Each call to getStatus() runs ONE step of the agent loop for progressive rendering.
     *
     * IMPORTANT: Uses processing lock to prevent concurrent polls from executing steps
     * simultaneously. This prevents race conditions where multiple polls read stale state.
     *
     * @param {string} requestId - Request ID from processChatAsync
     * @returns {Object} Progress state with current steps
     */
    function getStatus(requestId) {
        // Validate request ID format
        if (!requestId || typeof requestId !== 'string') {
            log.error('getStatus called with invalid requestId', {
                requestId: requestId,
                type: typeof requestId
            });
            return {
                status: 'not_found',
                error: 'Invalid request ID'
            };
        }

        // Get current state first
        const progressState = Cache.get(requestId);

        if (!progressState) {
            // Enhanced diagnostic logging for cache misses
            log.error('getStatus cache miss - request not found', {
                requestId: requestId,
                requestIdLength: requestId.length,
                requestIdPrefix: requestId.substring(0, 10),
                possibleCauses: [
                    'Request never created (init failed)',
                    'Cache TTL expired (5 min)',
                    'Cache scope mismatch (different user session)',
                    'Request ID corrupted in transit'
                ]
            });
            return {
                status: 'not_found',
                error: 'Request not found or expired. This may occur if the initial request failed or the session timed out.'
            };
        }

        // ATOMIC: Check if already complete or locked (prevents race conditions)
        if (Cache.isCompleteOrLocked(requestId)) {
            return Cache.getPollingResponse(requestId);
        }

        // If already complete or error, just return current state
        if (progressState.status === 'complete' || progressState.status === 'error') {
            return Cache.getPollingResponse(requestId);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PROCESSING LOCK: Prevent concurrent step execution
        // If another poll is already processing, just return current state
        // ═══════════════════════════════════════════════════════════════════════
        if (!Cache.acquireProcessingLock(requestId)) {
            Utils.debugLog('getStatus - another poll is processing, returning current state', {
                requestId: requestId
            });
            return Cache.getPollingResponse(requestId);
        }

        // Still processing - run next step
        // NOTE: We have the processing lock, so only ONE poll executes this block at a time
        try {
            // Re-check status after acquiring lock (might have completed while waiting)
            const freshState = Cache.get(requestId);
            if (!freshState || freshState.status === 'complete' || freshState.status === 'error') {
                Cache.releaseProcessingLock(requestId);
                return Cache.getPollingResponse(requestId);
            }

            const agentState = freshState.agentState;
            const stepResult = StreamingAgent.runStep(agentState);

            // Save updated state
            if (stepResult.hasMore) {
                Cache.setAgentState(requestId, agentState);
            } else if (stepResult.response) {
                // Complete with response
                Cache.complete(requestId, {
                    answer: stepResult.response.text,
                    richContent: stepResult.response.richContent,
                    sessionContext: stepResult.response.sessionContext,
                    model: AIProviders.getCurrentModelInfo().model,
                    provider: AIProviders.getCurrentModelInfo().provider
                });
            }

            Utils.debugLog('getStatus ran step', {
                requestId: requestId,
                phase: agentState.phase,
                hasMore: stepResult.hasMore,
                hasResponse: !!stepResult.response
            });

            // Release processing lock and return updated polling response
            Cache.releaseProcessingLock(requestId);
            return Cache.getPollingResponse(requestId);

        } catch (e) {
            // Enhanced error logging with provider info
            const errorDetails = {
                requestId: requestId,
                error: e.message,
                stack: e.stack,
                errorName: e.name,
                iteration: progressState.agentState?.iteration || 0
            };

            // Check for provider-specific errors
            if (e.message && (e.message.includes('NetSuite') || e.message.includes('Cohere'))) {
                errorDetails.provider = 'netsuite';
                errorDetails.hint = 'NetSuite/Cohere LLM error - check N/llm module compatibility';
            } else if (e.message && e.message.includes('OpenAI')) {
                errorDetails.provider = 'openai';
            } else if (e.message && e.message.includes('Gemini')) {
                errorDetails.provider = 'gemini';
            } else if (e.message && e.message.includes('Anthropic')) {
                errorDetails.provider = 'anthropic';
            }

            log.error('getStatus step error', errorDetails);

            // Store failure state so subsequent polls don't retry
            Cache.fail(requestId, e.message);

            // Release processing lock before returning
            Cache.releaseProcessingLock(requestId);
            return Cache.getPollingResponse(requestId);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        // Main entry points
        processChatAsync: processChatAsync,
        getStatus: getStatus,

        // AI Providers (re-exported for backward compatibility)
        callAI: AIProviders.callAI,
        getAIConfig: AIProviders.getAIConfig,
        getCurrentModelInfo: AIProviders.getCurrentModelInfo,
        getUsage: AIProviders.getUsage,

        // Tools
        getTools: Tools.getToolDefinitions,
        executeTool: Tools.executeTool,

        // Utilities
        cleanQuery: Utils.cleanQuery,
        extractJsonFromText: Utils.extractJsonFromText,
        checkGovernance: Utils.checkGovernance,

        // Version identifier
        VERSION: '3.0'
    };
});
