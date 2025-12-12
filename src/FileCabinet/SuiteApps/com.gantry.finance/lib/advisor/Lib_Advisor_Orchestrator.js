/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_Orchestrator.js
 * Main orchestration for LLM-powered financial advisor
 *
 * ARCHITECTURE:
 * - Streaming Context Architecture (SCA) for fast, lightweight LLM calls
 * - Legacy Agent mode available via USE_STREAMING_AGENT flag
 * - Progressive rendering via polling
 *
 * FLOW:
 * 1. processChat() - Main entry point (synchronous, waits for completion)
 * 2. processChatAsync() - Returns request_id immediately, use polling for updates
 * 3. getStatus() - Poll for progress updates, each poll advances one phase
 */
define([
    'N/log',
    './Lib_Advisor_Agent',
    './Lib_Advisor_StreamingAgent',
    './Lib_Advisor_ProgressStore',
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_ResponseBuilder',
    './Lib_Advisor_Utils',
    './Lib_Advisor_Tools',
    '../Lib_Config'
], function(
    log,
    Agent,
    StreamingAgent,
    ProgressStore,
    AIProviders,
    ResponseBuilder,
    Utils,
    Tools,
    ConfigLib
) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // STREAMING CONTEXT ARCHITECTURE (SCA) MODE
    // When enabled, uses multi-phase lightweight LLM calls instead of monolithic
    // ═══════════════════════════════════════════════════════════════════════════

    // Set to true to enable Streaming Context Architecture (default: true)
    // Set to false to use legacy single-call agent
    const USE_STREAMING_AGENT = true;

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN ENTRY POINT - Synchronous (backward compatible)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Process a chat message and return AI-generated response
     * This is the synchronous version that waits for completion.
     *
     * @param {Object} params - Chat parameters
     * @param {string} params.message - User's message
     * @param {Array} params.history - Conversation history
     * @param {Object} params.sessionContext - Persistent session context
     * @param {Object} params.aiSettings - AI settings including debugMode
     * @returns {Object} Response with text, steps, richContent, etc.
     */
    function processChat(params) {
        const startTime = Date.now();
        const message = params.message || '';
        const history = params.history || [];
        const sessionContext = params.sessionContext || {};
        const aiSettings = params.aiSettings || {};

        // Enable debug mode if requested
        Utils.resetDebugModeCache();
        if (aiSettings.debugMode === true) {
            Utils.setForceDebugMode(true);
        }

        log.debug('ProcessChat v2 starting', {
            messageLength: message.length,
            historyLength: history.length,
            hasSessionContext: !!sessionContext
        });

        try {
            // Check for simple conversational patterns (no LLM needed)
            const conversationalResponse = matchConversationalPattern(message);
            if (conversationalResponse) {
                return {
                    text: '',
                    richContent: [{ type: 'text', content: conversationalResponse }],
                    blocksFormat: true,
                    steps: [],
                    duration: Date.now() - startTime,
                    sessionContext: sessionContext
                };
            }

            // Run the agent synchronously
            const result = Agent.runAgentSync(message, history, sessionContext, {
                debugMode: aiSettings.debugMode
            });

            // Ensure session context is preserved
            result.sessionContext = result.sessionContext || sessionContext;

            return result;

        } catch (e) {
            log.error('Orchestrator v2 Error', { message: e.message, stack: e.stack });

            return {
                text: '',
                richContent: [{ type: 'text', content: 'An unexpected error occurred: ' + e.message }],
                blocksFormat: true,
                steps: [{
                    type: 'error',
                    title: 'System Error',
                    content: e.message,
                    status: 'error',
                    timestamp: Date.now()
                }],
                duration: Date.now() - startTime,
                sessionContext: sessionContext,
                error: true
            };
        }
    }

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
        const requestId = ProgressStore.generateRequestId();

        // Enable debug mode if requested
        Utils.resetDebugModeCache();
        if (aiSettings.debugMode === true) {
            Utils.setForceDebugMode(true);
        }

        log.debug('ProcessChatAsync starting (step-by-step mode)', {
            requestId: requestId,
            messageLength: message.length
        });

        try {
            // Check for simple conversational patterns (no agent needed)
            const conversationalResponse = matchConversationalPattern(message);
            if (conversationalResponse) {
                // Create progress entry without agent state
                ProgressStore.create(requestId, message, null);
                ProgressStore.complete(requestId, {
                    answer: conversationalResponse,
                    richContent: [{ type: 'text', content: conversationalResponse }],
                    sessionContext: sessionContext,
                    model: 'Gantry',
                    provider: 'system'
                });

                return {
                    request_id: requestId,
                    status: 'complete'
                };
            }

            // ═══════════════════════════════════════════════════════════════
            // STREAMING CONTEXT ARCHITECTURE (SCA) vs LEGACY AGENT
            // ═══════════════════════════════════════════════════════════════

            let agentState;

            if (USE_STREAMING_AGENT) {
                // NEW: Use Streaming Agent with multi-phase lightweight calls
                log.debug('Using Streaming Context Architecture (SCA)', { requestId: requestId });

                agentState = StreamingAgent.initState(message, sessionContext, requestId, history);
                agentState.useStreamingAgent = true; // Flag for getStatus to know which agent to use

                // Create progress entry
                ProgressStore.create(requestId, message, agentState);

                // Initial step will be added by first phase execution

            } else {
                // LEGACY: Use traditional single-call agent
                log.debug('Using Legacy Agent', { requestId: requestId });

                agentState = Agent.initAgentState(message, history, sessionContext, requestId, {
                    debugMode: aiSettings.debugMode
                });

                // Create progress entry WITH agent state
                ProgressStore.create(requestId, message, agentState);

                // Add initial thinking step as a placeholder that will be updated
                // by the AI planning call on first poll.
                const thinkingStep = {
                    type: 'thinking',
                    title: 'Understanding your question...',
                    status: 'in_progress',
                    context: {
                        question: message,
                        status: 'Creating analysis plan...'
                    }
                };

                // Add extended debug info when debug mode is enabled
                if (Utils.isDebugMode()) {
                    const resolvedEntities = sessionContext.resolvedEntities || {};
                    const toolDefs = Tools.getToolDefinitions();
                    thinkingStep.debug = {
                        userMessage: message,
                        historyLength: history.length,
                        sessionEntities: Object.keys(resolvedEntities),
                        resolvedEntityDetails: resolvedEntities,
                        availableTools: toolDefs.map(t => t.name)
                    };
                    thinkingStep.title = 'Understanding your question (Debug Mode ON)';
                }

                ProgressStore.addStep(requestId, thinkingStep);
            }

            // TRULY ASYNC: Return immediately - first LLM step runs on first poll
            log.debug('ProcessChatAsync returning immediately', {
                requestId: requestId,
                mode: USE_STREAMING_AGENT ? 'SCA' : 'legacy',
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
                ProgressStore.fail(requestId, e.message);
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
        const progressState = ProgressStore.get(requestId);

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
        if (ProgressStore.isCompleteOrLocked(requestId)) {
            return ProgressStore.getPollingResponse(requestId);
        }

        // If already complete or error, just return current state
        if (progressState.status === 'complete' || progressState.status === 'error') {
            return ProgressStore.getPollingResponse(requestId);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PROCESSING LOCK: Prevent concurrent step execution
        // If another poll is already processing, just return current state
        // ═══════════════════════════════════════════════════════════════════════
        if (!ProgressStore.acquireProcessingLock(requestId)) {
            log.debug('getStatus - another poll is processing, returning current state', {
                requestId: requestId
            });
            return ProgressStore.getPollingResponse(requestId);
        }

        // Still processing - run next step
        // NOTE: We have the processing lock, so only ONE poll executes this block at a time
        try {
            // Re-check status after acquiring lock (might have completed while waiting)
            const freshState = ProgressStore.get(requestId);
            if (!freshState || freshState.status === 'complete' || freshState.status === 'error') {
                ProgressStore.releaseProcessingLock(requestId);
                return ProgressStore.getPollingResponse(requestId);
            }

            let stepResult;

            // Check which agent to use based on state flag
            const useStreaming = freshState.agentState?.useStreamingAgent === true;

            if (useStreaming) {
                // ═══════════════════════════════════════════════════════════
                // STREAMING CONTEXT ARCHITECTURE (SCA)
                // Multi-phase lightweight calls - each phase is 1-3 seconds
                // ═══════════════════════════════════════════════════════════
                const agentState = freshState.agentState;

                stepResult = StreamingAgent.runStep(agentState);

                // Save updated state
                if (stepResult.hasMore) {
                    ProgressStore.setAgentState(requestId, agentState);
                } else if (stepResult.response) {
                    // Complete with response
                    ProgressStore.complete(requestId, {
                        answer: stepResult.response.text,
                        richContent: stepResult.response.richContent,
                        sessionContext: stepResult.response.sessionContext,
                        model: AIProviders.getCurrentModelInfo().model,
                        provider: AIProviders.getCurrentModelInfo().provider
                    });
                }

                log.debug('getStatus ran SCA step', {
                    requestId: requestId,
                    phase: agentState.phase,
                    hasMore: stepResult.hasMore,
                    hasResponse: !!stepResult.response
                });

            } else {
                // ═══════════════════════════════════════════════════════════
                // LEGACY AGENT
                // Single-call approach (backward compatibility)
                // ═══════════════════════════════════════════════════════════
                stepResult = Agent.runAgentStep(requestId);

                log.debug('getStatus ran legacy step', {
                    requestId: requestId,
                    hasMore: stepResult.hasMore,
                    hasError: !!stepResult.error,
                    iteration: progressState.agentState?.iteration || 0
                });
            }

            // Release processing lock and return updated polling response
            ProgressStore.releaseProcessingLock(requestId);
            return ProgressStore.getPollingResponse(requestId);

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
            ProgressStore.fail(requestId, e.message);

            // Release processing lock before returning
            ProgressStore.releaseProcessingLock(requestId);
            return ProgressStore.getPollingResponse(requestId);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONVERSATIONAL PATTERN MATCHING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Match simple conversational patterns that don't need LLM
     */
    function matchConversationalPattern(message) {
        if (!message) return null;

        const lower = message.toLowerCase().trim();

        // Greetings
        const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'];
        if (greetings.some(g => lower === g || lower === g + '!')) {
            return "Hello! I'm your financial advisor. Ask me anything about your company's finances - cash position, vendor spend, customer revenue, GL activity, or use one of our specialized dashboards for deeper analysis.";
        }

        // Thanks
        const thanks = ['thanks', 'thank you', 'thx', 'ty'];
        if (thanks.some(t => lower === t || lower === t + '!')) {
            return "You're welcome! Let me know if you have any other financial questions.";
        }

        // Help
        if (lower === 'help' || lower === '?') {
            return getHelpMessage();
        }

        return null;
    }

    /**
     * Get help message
     */
    function getHelpMessage() {
        return `**I can help you with:**

**Cash & Treasury**
- Cash position, bank balances, runway
- Cash flow projections

**Accounts Payable**
- AP aging, vendor balances
- Vendor spend analysis

**Accounts Receivable**
- AR aging, customer balances
- Customer revenue analysis

**General Ledger**
- GL activity by account, class, or department
- Trial balance
- Variance analysis

**Dashboards** (ask about any):
- Treasury (cashflow)
- Profitability Pulse (health)
- Rate Engine (burden)
- Utilization (time)
- Sentinel (integrity)
- Procurement (vendor performance)
- Revenue Intelligence (customer value)
- Cost Dynamics (spend velocity)

**Example questions:**
- "What's our cash position?"
- "Show me AP aging"
- "Top 10 customers by revenue"
- "GL activity for the Hotels class"
- "What's causing the variance in expenses?"`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BACKWARD COMPATIBILITY EXPORTS
    // Re-export commonly used functions from submodules
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        // Main entry points
        processChat: processChat,
        processChatAsync: processChatAsync,
        getStatus: getStatus,

        // AI Providers (re-exported for backward compatibility)
        callAI: AIProviders.callAI,
        getAIConfig: AIProviders.getAIConfig,
        getCurrentModelInfo: AIProviders.getCurrentModelInfo,
        getUsage: AIProviders.getUsage,

        // Tools (new)
        getTools: Tools.getToolDefinitions,
        executeTool: Tools.executeTool,

        // Response building
        buildResponse: ResponseBuilder.buildResponse,

        // Utilities
        cleanQuery: Utils.cleanQuery,
        extractJsonFromText: Utils.extractJsonFromText,
        checkGovernance: Utils.checkGovernance,

        // Version identifier
        VERSION: '2.0'
    };
});
