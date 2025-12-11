/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_ProgressStore.js
 * Progress tracking for progressive rendering using N/cache
 *
 * Enables poll-based progressive UI updates:
 * 1. Frontend sends request, receives request_id immediately
 * 2. Frontend polls /advisor_status?id=xxx every 500ms
 * 3. Backend stores steps as they complete
 * 4. Frontend renders steps progressively
 *
 * Uses N/cache for temporary storage (auto-expires after TTL)
 *
 * CACHE ARCHITECTURE (to avoid 500KB limit):
 * - {requestId}        : Main state (status, steps, metadata) - kept small
 * - {requestId}_agent  : Agent state (conversation context, tool signatures)
 * - {requestId}_tools  : Tool call results (can overflow to _tools_1, _tools_2, etc.)
 * - {requestId}_ctx    : Conversation context overflow
 */
define(['N/cache', 'N/log'], function(cache, log) {
    'use strict';

    // Cache configuration
    const CACHE_NAME = 'ADVISOR_PROGRESS';
    const DEFAULT_TTL = 900; // 15 minutes - increased for complex queries
    const REFRESH_TTL_ON_ACCESS = true; // Re-save on access to extend TTL
    const MAX_CACHE_SIZE_KB = 450; // Leave buffer below 500KB limit
    const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_KB * 1024;

    // Get or create the cache
    // CRITICAL: Must use PUBLIC scope so cache is shared across HTTP requests
    // PRIVATE scope is tied to execution context and won't persist between
    // the async request and subsequent polling requests
    let progressCache = null;

    function getCache() {
        if (!progressCache) {
            progressCache = cache.getCache({
                name: CACHE_NAME,
                scope: cache.Scope.PUBLIC  // Changed from PRIVATE - must be PUBLIC for cross-request access
            });
        }
        return progressCache;
    }

    /**
     * Safely put data to cache with size checking
     * @param {string} key - Cache key
     * @param {object} data - Data to store
     * @param {number} ttl - TTL in seconds
     * @returns {boolean} True if successful
     */
    function safePut(key, data, ttl) {
        try {
            const json = JSON.stringify(data);
            const sizeBytes = json.length;
            const sizeKB = Math.round(sizeBytes / 1024);

            if (sizeBytes > MAX_CACHE_SIZE_BYTES) {
                log.error('ProgressStore.safePut - data too large', {
                    key: key,
                    sizeKB: sizeKB,
                    maxKB: MAX_CACHE_SIZE_KB
                });
                return false;
            }

            if (sizeKB > 300) {
                log.audit('ProgressStore cache size warning', { key: key, sizeKB: sizeKB });
            }

            getCache().put({
                key: key,
                value: json,
                ttl: ttl || DEFAULT_TTL
            });
            return true;
        } catch (e) {
            log.error('ProgressStore.safePut failed', { key: key, error: e.message });
            return false;
        }
    }

    /**
     * Get data from cache
     * @param {string} key - Cache key
     * @returns {object|null} Parsed data or null
     */
    function safeGet(key) {
        try {
            const raw = getCache().get({ key: key });
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            log.error('ProgressStore.safeGet failed', { key: key, error: e.message });
            return null;
        }
    }

    /**
     * Remove data from cache
     * @param {string} key - Cache key
     */
    function safeRemove(key) {
        try {
            getCache().remove({ key: key });
        } catch (e) {
            // Ignore
        }
    }

    /**
     * Generate a unique request ID
     * @returns {string} Unique request ID
     */
    function generateRequestId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        return `adv_${timestamp}_${random}`;
    }

    /**
     * Create a new progress tracking entry with agent state for step-by-step execution
     * Uses separate cache keys to avoid 500KB limit:
     * - Main key: status, steps, metadata (small)
     * - Agent key: agent state without toolDefinitions (medium)
     * - Tools key: tool call results (can be large)
     *
     * @param {string} requestId - Unique request ID
     * @param {string} message - Original user message
     * @param {object} agentState - Initial agent state for resumable execution
     * @returns {object} Initial progress state
     */
    function create(requestId, message, agentState) {
        // Main state - kept small for fast polling
        const mainState = {
            requestId: requestId,
            status: 'processing',
            message: message,
            steps: [],
            startTime: Date.now(),
            lastUpdate: Date.now(),
            answer: null,
            richContent: null,
            sessionContext: null,
            error: null,
            // Flag indicating agent state is stored separately
            hasAgentState: !!agentState
        };

        // Store main state
        if (!safePut(requestId, mainState)) {
            log.error('ProgressStore.create - failed to store main state', { requestId: requestId });
            return mainState;
        }

        // Store agent state separately (without toolDefinitions - regenerated each step)
        if (agentState) {
            // Create a trimmed copy without toolDefinitions (they're regenerated each step)
            const trimmedAgentState = {
                ...agentState,
                toolDefinitions: null,  // Don't store - regenerate on each step
                // Keep tool call results minimal - store summaries only
                allToolCalls: (agentState.allToolCalls || []).map(tc => ({
                    tool: tc.tool,
                    args: tc.args,
                    displayName: tc.displayName,
                    duration: tc.duration,
                    // Store only summary, not full result
                    resultSummary: tc.result ? {
                        success: tc.result.success,
                        rowCount: tc.result.rowCount || 0,
                        found: tc.result.found,
                        entityId: tc.result.entity?.id,
                        error: tc.result.error
                    } : null
                }))
            };

            if (!safePut(requestId + '_agent', trimmedAgentState)) {
                log.error('ProgressStore.create - failed to store agent state', { requestId: requestId });
            }
        }

        log.debug('ProgressStore.create', { requestId: requestId, hasAgentState: !!agentState });
        return mainState;
    }

    /**
     * Add a step to the progress
     * @param {string} requestId - Request ID
     * @param {object} step - Step object with type, title, status, etc.
     */
    function addStep(requestId, step) {
        try {
            const state = safeGet(requestId);
            if (!state) {
                log.debug('ProgressStore.addStep - request not found', { requestId: requestId });
                return;
            }

            // Add timestamp if not present
            if (!step.timestamp) {
                step.timestamp = Date.now();
            }

            // Default status
            if (!step.status) {
                step.status = 'complete';
            }

            state.steps.push(step);
            state.lastUpdate = Date.now();

            if (!safePut(requestId, state)) {
                log.error('ProgressStore.addStep - failed to save', { requestId: requestId });
            }

            log.debug('ProgressStore.addStep', {
                requestId: requestId,
                stepType: step.type,
                stepTitle: step.title,
                totalSteps: state.steps.length
            });
        } catch (e) {
            log.error('ProgressStore.addStep failed', { requestId: requestId, error: e.message });
        }
    }

    /**
     * Update the last step (e.g., change status from running to complete)
     * @param {string} requestId - Request ID
     * @param {object} updates - Properties to update on last step
     */
    function updateLastStep(requestId, updates) {
        try {
            const state = safeGet(requestId);
            if (!state || state.steps.length === 0) return;

            const lastStep = state.steps[state.steps.length - 1];
            Object.assign(lastStep, updates);
            state.lastUpdate = Date.now();

            safePut(requestId, state);
        } catch (e) {
            log.error('ProgressStore.updateLastStep failed', { requestId: requestId, error: e.message });
        }
    }

    /**
     * Update a specific step by type (e.g., update 'thinking' step with actual AI plan)
     * @param {string} requestId - Request ID
     * @param {string} stepType - The type of step to update
     * @param {object} updates - Properties to update on the step
     * @returns {boolean} True if step was found and updated
     */
    function updateStepByType(requestId, stepType, updates) {
        try {
            const state = safeGet(requestId);
            if (!state) return false;

            const stepIndex = state.steps.findIndex(s => s.type === stepType);
            if (stepIndex === -1) return false;

            Object.assign(state.steps[stepIndex], updates);
            state.lastUpdate = Date.now();

            return safePut(requestId, state);
        } catch (e) {
            log.error('ProgressStore.updateStepByType failed', { requestId: requestId, stepType: stepType, error: e.message });
            return false;
        }
    }

    /**
     * Mark request as complete with final answer
     * Also cleans up the separate agent state cache
     * @param {string} requestId - Request ID
     * @param {object} result - Result object with answer, richContent, sessionContext
     */
    function complete(requestId, result) {
        try {
            const state = safeGet(requestId);
            if (!state) {
                log.debug('ProgressStore.complete - request not found', { requestId: requestId });
                return;
            }

            state.status = 'complete';
            state.answer = result.answer || result.text || '';
            state.richContent = result.richContent || null;
            state.sessionContext = result.sessionContext || null;
            state.duration = Date.now() - state.startTime;
            state.lastUpdate = Date.now();
            state.model = result.model || null;
            state.provider = result.provider || null;
            // Clear the agent state reference since we're done
            state.hasAgentState = false;

            safePut(requestId, state);

            // Clean up separate agent state cache
            safeRemove(requestId + '_agent');
            safeRemove(requestId + '_ctx');

            log.debug('ProgressStore.complete', {
                requestId: requestId,
                duration: state.duration,
                stepCount: state.steps.length
            });
        } catch (e) {
            log.error('ProgressStore.complete failed', { requestId: requestId, error: e.message });
        }
    }

    /**
     * Mark request as failed with error
     * Creates an error entry if one doesn't exist (for early failures)
     * Also cleans up separate cache keys
     * @param {string} requestId - Request ID
     * @param {string} error - Error message
     */
    function fail(requestId, error) {
        try {
            let state = safeGet(requestId);
            const hadExistingEntry = !!state;

            if (!state) {
                // Create an error entry if none exists (handles early failures)
                log.debug('ProgressStore.fail - creating error entry for missing request', {
                    requestId: requestId,
                    error: error
                });
                state = {
                    requestId: requestId,
                    status: 'error',
                    message: '',
                    steps: [{
                        type: 'error',
                        title: 'Request failed',
                        status: 'error',
                        error: error,
                        timestamp: Date.now()
                    }],
                    startTime: Date.now(),
                    lastUpdate: Date.now(),
                    answer: null,
                    richContent: null,
                    sessionContext: null,
                    error: error,
                    hasAgentState: false,
                    duration: 0
                };
            } else {
                state.status = 'error';
                state.error = error;
                state.duration = Date.now() - state.startTime;
                state.lastUpdate = Date.now();
                state.hasAgentState = false;

                // Add error step if not already present
                const hasErrorStep = state.steps.some(s => s.type === 'error');
                if (!hasErrorStep) {
                    state.steps.push({
                        type: 'error',
                        title: 'An error occurred',
                        status: 'error',
                        error: error,
                        timestamp: Date.now()
                    });
                }
            }

            safePut(requestId, state);

            // Clean up separate cache keys
            safeRemove(requestId + '_agent');
            safeRemove(requestId + '_ctx');

            log.error('ProgressStore.fail', { requestId: requestId, error: error, hadExistingEntry: hadExistingEntry });
        } catch (e) {
            log.error('ProgressStore.fail failed', { requestId: requestId, error: e.message, originalError: error });
        }
    }

    /**
     * Get current progress state and optionally refresh TTL
     * @param {string} requestId - Request ID
     * @param {boolean} refreshTtl - Whether to refresh TTL on access (default: REFRESH_TTL_ON_ACCESS)
     * @returns {object|null} Progress state or null if not found
     */
    function get(requestId, refreshTtl) {
        try {
            const state = safeGet(requestId);
            if (!state) {
                return null;
            }

            // Refresh TTL on access to extend cache lifetime during active polling
            // This helps prevent cache expiration during long-running agent operations
            if (refreshTtl !== false && REFRESH_TTL_ON_ACCESS && state.status === 'processing') {
                state.lastAccess = Date.now();
                // Best effort TTL refresh - don't fail the get if it fails
                safePut(requestId, state);
                // Also refresh agent state TTL if it exists
                if (state.hasAgentState) {
                    const agentState = safeGet(requestId + '_agent');
                    if (agentState) {
                        safePut(requestId + '_agent', agentState);
                    }
                }
            }

            return state;
        } catch (e) {
            log.error('ProgressStore.get failed', { requestId: requestId, error: e.message });
            return null;
        }
    }

    /**
     * Get agent state for step-by-step execution
     * Reads from separate _agent cache key
     * @param {string} requestId - Request ID
     * @returns {object|null} Agent state or null
     */
    function getAgentState(requestId) {
        try {
            // First check if main state exists
            const mainState = safeGet(requestId);
            if (!mainState) return null;

            // Get agent state from separate key
            const agentState = safeGet(requestId + '_agent');
            if (!agentState) {
                log.debug('ProgressStore.getAgentState - agent state not found', { requestId: requestId });
                return null;
            }

            return agentState;
        } catch (e) {
            log.error('ProgressStore.getAgentState failed', { requestId: requestId, error: e.message });
            return null;
        }
    }

    /**
     * Set agent state for step-by-step execution
     * Stores in separate _agent cache key with size management
     * - toolDefinitions are NOT stored (regenerated each step)
     * - allToolCalls stores summaries only, not full results
     * - conversationContext overflows to _ctx key if needed
     *
     * @param {string} requestId - Request ID
     * @param {object} agentState - Agent state to store
     * @returns {boolean} True if successful
     */
    function setAgentState(requestId, agentState) {
        try {
            // First check main state exists
            const mainState = safeGet(requestId);
            if (!mainState) {
                log.debug('ProgressStore.setAgentState - request not found', { requestId: requestId });
                return false;
            }

            // Create a trimmed copy for storage
            const trimmedState = {
                ...agentState,
                // Don't store toolDefinitions - regenerated each step
                toolDefinitions: null
            };

            // Trim allToolCalls to store summaries only
            if (trimmedState.allToolCalls && trimmedState.allToolCalls.length > 0) {
                trimmedState.allToolCalls = trimmedState.allToolCalls.map(tc => ({
                    tool: tc.tool,
                    args: tc.args,
                    displayName: tc.displayName,
                    duration: tc.duration,
                    // Store summary instead of full result
                    resultSummary: tc.result ? {
                        success: tc.result.success,
                        rowCount: tc.result.rowCount || 0,
                        found: tc.result.found,
                        entityId: tc.result.entity?.id,
                        error: tc.result.error
                    } : (tc.resultSummary || null)
                }));
            }

            // Check if conversation context is too large - overflow to separate key
            const MAX_CONTEXT_SIZE = 100 * 1024; // 100KB max in main state
            if (trimmedState.conversationContext && trimmedState.conversationContext.length > MAX_CONTEXT_SIZE) {
                // Store full context in separate key
                const ctxStored = safePut(requestId + '_ctx', {
                    conversationContext: trimmedState.conversationContext
                });

                if (ctxStored) {
                    // Keep only recent context in main state
                    trimmedState.conversationContext = trimmedState.conversationContext.slice(-MAX_CONTEXT_SIZE);
                    trimmedState.hasContextOverflow = true;
                }
            }

            // Store the trimmed agent state
            const success = safePut(requestId + '_agent', trimmedState);

            if (success) {
                // Update main state timestamp
                mainState.lastUpdate = Date.now();
                mainState.hasAgentState = true;
                safePut(requestId, mainState);

                log.debug('ProgressStore.setAgentState', {
                    requestId: requestId,
                    iteration: agentState.iteration,
                    toolCallCount: trimmedState.allToolCalls?.length || 0,
                    hasContextOverflow: trimmedState.hasContextOverflow || false
                });
            } else {
                log.error('ProgressStore.setAgentState - failed to store', {
                    requestId: requestId,
                    iteration: agentState.iteration
                });
            }

            return success;
        } catch (e) {
            log.error('ProgressStore.setAgentState failed', { requestId: requestId, error: e.message });
            return false;
        }
    }

    /**
     * Check if request exists
     * @param {string} requestId - Request ID
     * @returns {boolean}
     */
    function exists(requestId) {
        return !!safeGet(requestId);
    }

    /**
     * Delete a progress entry and all related cache keys
     * @param {string} requestId - Request ID
     */
    function remove(requestId) {
        safeRemove(requestId);
        safeRemove(requestId + '_agent');
        safeRemove(requestId + '_ctx');
    }

    /**
     * Get formatted response for polling endpoint
     * @param {string} requestId - Request ID
     * @returns {object} Response object for frontend
     */
    function getPollingResponse(requestId) {
        const state = get(requestId);

        if (!state) {
            return {
                status: 'not_found',
                error: 'Request not found or expired'
            };
        }

        // Build response based on status
        const response = {
            requestId: state.requestId,
            status: state.status,
            steps: state.steps,
            duration: Date.now() - state.startTime
        };

        if (state.status === 'complete') {
            response.answer = state.answer;
            response.richContent = state.richContent;
            response.sessionContext = state.sessionContext;
            response.model = state.model;
            response.provider = state.provider;
            response.totalDuration = state.duration;
        }

        if (state.status === 'error') {
            response.error = state.error;
        }

        return response;
    }

    // Public API
    return {
        generateRequestId: generateRequestId,
        create: create,
        addStep: addStep,
        updateLastStep: updateLastStep,
        updateStepByType: updateStepByType,
        complete: complete,
        fail: fail,
        get: get,
        getAgentState: getAgentState,
        setAgentState: setAgentState,
        exists: exists,
        remove: remove,
        getPollingResponse: getPollingResponse
    };
});
