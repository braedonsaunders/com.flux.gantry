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
 * SIMPLIFIED CACHE ARCHITECTURE:
 * - Single key per request: {requestId}
 * - Contains: status, steps, agentState (all in one entry)
 * - Avoids multi-key complexity and reduces eviction risk
 * - toolDefinitions are NOT stored (regenerated each step to save ~100KB)
 * - allToolCalls stores summaries only (not full results)
 *
 * IMPORTANT: NetSuite cache can evict entries at ANY time regardless of TTL.
 * This is documented behavior. Design for resilience.
 */
define(['N/cache', 'N/log'], function(cache, log) {
    'use strict';

    // Cache configuration
    const CACHE_NAME = 'ADVISOR_PROGRESS';
    const DEFAULT_TTL = 900; // 15 minutes
    const MAX_CACHE_SIZE_KB = 450; // Leave buffer below 500KB limit
    const MAX_CACHE_SIZE_BYTES = MAX_CACHE_SIZE_KB * 1024;

    // Atomic completion lock configuration
    const LOCK_PREFIX = 'lock_';
    const LOCK_TTL = 30; // Lock expires after 30 seconds (safety net)

    /**
     * Get the cache - always get fresh reference
     * Uses PUBLIC scope to share across all scripts in the account
     */
    function getCache() {
        return cache.getCache({
            name: CACHE_NAME,
            scope: cache.Scope.PUBLIC
        });
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
            if (!raw) {
                return null;
            }
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
            // Ignore removal errors
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ATOMIC COMPLETION LOCK
    // Prevents race conditions when multiple polls complete simultaneously
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Try to acquire completion lock for a request
     * @param {string} requestId - Request ID
     * @returns {boolean} True if lock acquired, false if already locked
     */
    function acquireCompletionLock(requestId) {
        const lockKey = LOCK_PREFIX + requestId;
        try {
            const existing = getCache().get({ key: lockKey });
            if (existing) {
                log.debug('ProgressStore.acquireCompletionLock - already locked', { requestId: requestId });
                return false;
            }

            // Set the lock
            getCache().put({
                key: lockKey,
                value: JSON.stringify({ locked: true, timestamp: Date.now() }),
                ttl: LOCK_TTL
            });

            log.debug('ProgressStore.acquireCompletionLock - acquired', { requestId: requestId });
            return true;
        } catch (e) {
            log.error('ProgressStore.acquireCompletionLock failed', { requestId: requestId, error: e.message });
            return false;
        }
    }

    /**
     * Check if a request has a completion lock (without acquiring)
     * @param {string} requestId - Request ID
     * @returns {boolean} True if locked
     */
    function hasCompletionLock(requestId) {
        const lockKey = LOCK_PREFIX + requestId;
        try {
            const existing = getCache().get({ key: lockKey });
            return !!existing;
        } catch (e) {
            return false;
        }
    }

    /**
     * Release completion lock
     * @param {string} requestId - Request ID
     */
    function releaseCompletionLock(requestId) {
        const lockKey = LOCK_PREFIX + requestId;
        safeRemove(lockKey);
    }

    /**
     * Check if request is already complete or completing
     * @param {string} requestId - Request ID
     * @returns {boolean} True if should skip processing
     */
    function isCompleteOrLocked(requestId) {
        // Check lock first (faster)
        if (hasCompletionLock(requestId)) {
            return true;
        }

        // Check actual status
        const state = safeGet(requestId);
        if (state && (state.status === 'complete' || state.status === 'error')) {
            return true;
        }

        return false;
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
     * Trim agent state for storage - removes large data that can be regenerated
     * @param {object} agentState - Full agent state
     * @returns {object} Trimmed agent state safe for storage
     */
    function trimAgentStateForStorage(agentState) {
        if (!agentState) return null;

        return {
            ...agentState,
            // Don't store toolDefinitions - regenerated each step (~100KB savings)
            toolDefinitions: null,
            // Keep tool calls minimal - store summaries only
            // CRITICAL: Keep property name as "result" (not "resultSummary") so all agent code works!
            allToolCalls: (agentState.allToolCalls || []).map(tc => ({
                tool: tc.tool,
                args: tc.args,
                displayName: tc.displayName,
                duration: tc.duration,
                // Store trimmed result - keep name as "result" for consistency with agent code
                result: tc.result ? {
                    success: tc.result.success,
                    rowCount: tc.result.rowCount || (tc.result.rows ? tc.result.rows.length : 0),
                    found: tc.result.found,
                    entity: tc.result.entity,  // Keep full entity for resolution tracking
                    bestMatch: tc.result.bestMatch,  // Keep for classification/account resolution
                    error: tc.result.error,
                    isFormatResponse: tc.result.isFormatResponse,
                    verificationPending: tc.result.verificationPending
                    // Note: rows/data arrays are intentionally NOT stored to save space
                } : null
            }))
        };
    }

    /**
     * Create a new progress tracking entry with agent state for step-by-step execution
     * SINGLE KEY ARCHITECTURE: Everything stored in one cache entry to reduce eviction risk
     *
     * @param {string} requestId - Unique request ID
     * @param {string} message - Original user message
     * @param {object} agentState - Initial agent state for resumable execution
     * @returns {object} Initial progress state
     */
    function create(requestId, message, agentState) {
        // Combined state - everything in one entry
        const state = {
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
            // Agent state embedded directly (trimmed to save space)
            agentState: trimAgentStateForStorage(agentState)
        };

        if (!safePut(requestId, state)) {
            log.error('ProgressStore.create - failed to store state', { requestId: requestId });
        }

        log.debug('ProgressStore.create', { requestId: requestId, hasAgentState: !!agentState });
        return state;
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
     * Update a step by its phase context (used by SCA streaming agent)
     * Finds the LAST step matching the phase and updates it
     * @param {string} requestId - Request ID
     * @param {object} stepData - Full step data with context.phase
     * @returns {boolean} True if step was found and updated
     */
    function updateStep(requestId, stepData) {
        try {
            const state = safeGet(requestId);
            if (!state || !state.steps || state.steps.length === 0) return false;

            const phase = stepData.context?.phase;
            if (!phase) {
                // Fallback: update last step
                Object.assign(state.steps[state.steps.length - 1], stepData);
                state.lastUpdate = Date.now();
                return safePut(requestId, state);
            }

            // Find LAST step matching this phase (reverse search)
            let stepIndex = -1;
            for (let i = state.steps.length - 1; i >= 0; i--) {
                if (state.steps[i].context?.phase === phase) {
                    stepIndex = i;
                    break;
                }
            }

            if (stepIndex === -1) {
                // No matching step found - add as new step
                if (!stepData.timestamp) stepData.timestamp = Date.now();
                state.steps.push(stepData);
            } else {
                // Update existing step
                Object.assign(state.steps[stepIndex], stepData);
            }

            state.lastUpdate = Date.now();
            return safePut(requestId, state);
        } catch (e) {
            log.error('ProgressStore.updateStep failed', { requestId: requestId, error: e.message });
            return false;
        }
    }

    /**
     * Mark request as complete with final answer (ATOMIC)
     * Uses completion lock to prevent race conditions from concurrent polls
     * @param {string} requestId - Request ID
     * @param {object} result - Result object with answer, richContent, sessionContext
     * @returns {boolean} True if completion succeeded, false if already complete/locked
     */
    function complete(requestId, result) {
        try {
            // ATOMIC: Try to acquire completion lock first
            if (!acquireCompletionLock(requestId)) {
                log.debug('ProgressStore.complete - skipped (already locked)', { requestId: requestId });
                return false;
            }

            const state = safeGet(requestId);
            if (!state) {
                log.debug('ProgressStore.complete - request not found', { requestId: requestId });
                releaseCompletionLock(requestId);
                return false;
            }

            // Double-check status (belt and suspenders)
            if (state.status === 'complete' || state.status === 'error') {
                log.debug('ProgressStore.complete - already finalized', { requestId: requestId, status: state.status });
                releaseCompletionLock(requestId);
                return false;
            }

            state.status = 'complete';
            state.answer = result.answer || result.text || '';
            state.richContent = result.richContent || null;
            state.sessionContext = result.sessionContext || null;
            state.duration = Date.now() - state.startTime;
            state.lastUpdate = Date.now();
            state.model = result.model || null;
            state.provider = result.provider || null;
            // Clear agent state since we're done (save space)
            state.agentState = null;

            // CRITICAL: Check if safePut succeeded
            const putSuccess = safePut(requestId, state);
            if (!putSuccess) {
                log.error('ProgressStore.complete - safePut FAILED', { requestId: requestId });
                // Don't release lock - let it expire naturally to prevent retries
                return false;
            }

            log.debug('ProgressStore.complete - SUCCESS', {
                requestId: requestId,
                duration: state.duration,
                stepCount: state.steps.length
            });

            // Lock will expire naturally via TTL
            return true;
        } catch (e) {
            log.error('ProgressStore.complete failed', { requestId: requestId, error: e.message });
            releaseCompletionLock(requestId);
            return false;
        }
    }

    /**
     * Mark request as failed with error
     * Creates an error entry if one doesn't exist (for early failures)
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
                    agentState: null,
                    duration: 0
                };
            } else {
                state.status = 'error';
                state.error = error;
                state.duration = Date.now() - state.startTime;
                state.lastUpdate = Date.now();
                state.agentState = null;

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

            log.error('ProgressStore.fail', { requestId: requestId, error: error, hadExistingEntry: hadExistingEntry });
        } catch (e) {
            log.error('ProgressStore.fail failed', { requestId: requestId, error: e.message, originalError: error });
        }
    }

    /**
     * Get current progress state (without agent state for polling efficiency)
     * @param {string} requestId - Request ID
     * @returns {object|null} Progress state or null if not found
     */
    function get(requestId) {
        try {
            const state = safeGet(requestId);
            return state || null;
        } catch (e) {
            log.error('ProgressStore.get failed', { requestId: requestId, error: e.message });
            return null;
        }
    }

    /**
     * Get agent state for step-by-step execution
     * Reads from embedded agentState property (single-key architecture)
     * @param {string} requestId - Request ID
     * @returns {object|null} Agent state or null
     */
    function getAgentState(requestId) {
        try {
            const state = safeGet(requestId);
            if (!state) {
                log.debug('ProgressStore.getAgentState - request not found', { requestId: requestId });
                return null;
            }

            if (!state.agentState) {
                log.debug('ProgressStore.getAgentState - no agent state', { requestId: requestId });
                return null;
            }

            return state.agentState;
        } catch (e) {
            log.error('ProgressStore.getAgentState failed', { requestId: requestId, error: e.message });
            return null;
        }
    }

    /**
     * Set agent state for step-by-step execution
     * SINGLE KEY ARCHITECTURE: Updates embedded agentState property
     * - toolDefinitions are NOT stored (regenerated each step)
     * - allToolCalls stores summaries only, not full results
     *
     * @param {string} requestId - Request ID
     * @param {object} agentState - Agent state to store
     * @returns {boolean} True if successful
     */
    function setAgentState(requestId, agentState) {
        try {
            // Get current state
            const state = safeGet(requestId);
            if (!state) {
                log.debug('ProgressStore.setAgentState - request not found', { requestId: requestId });
                return false;
            }

            // Trim and embed the agent state
            state.agentState = trimAgentStateForStorage(agentState);
            state.lastUpdate = Date.now();

            // Store the updated state
            const success = safePut(requestId, state);

            if (success) {
                log.debug('ProgressStore.setAgentState', {
                    requestId: requestId,
                    iteration: agentState.iteration,
                    toolCallCount: state.agentState?.allToolCalls?.length || 0
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
     * Delete a progress entry
     * @param {string} requestId - Request ID
     */
    function remove(requestId) {
        safeRemove(requestId);
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
        updateStep: updateStep, // Phase-aware step update for SCA
        complete: complete,
        fail: fail,
        get: get,
        getAgentState: getAgentState,
        setAgentState: setAgentState,
        exists: exists,
        remove: remove,
        getPollingResponse: getPollingResponse,

        // Atomic completion lock functions
        acquireCompletionLock: acquireCompletionLock,
        hasCompletionLock: hasCompletionLock,
        releaseCompletionLock: releaseCompletionLock,
        isCompleteOrLocked: isCompleteOrLocked
    };
});
