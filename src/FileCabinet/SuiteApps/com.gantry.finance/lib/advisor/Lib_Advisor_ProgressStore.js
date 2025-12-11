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
 */
define(['N/cache', 'N/log'], function(cache, log) {
    'use strict';

    // Cache configuration
    const CACHE_NAME = 'ADVISOR_PROGRESS';
    const DEFAULT_TTL = 300; // 5 minutes

    // Get or create the cache
    let progressCache = null;

    function getCache() {
        if (!progressCache) {
            progressCache = cache.getCache({
                name: CACHE_NAME,
                scope: cache.Scope.PRIVATE
            });
        }
        return progressCache;
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
     * Create a new progress tracking entry
     * @param {string} requestId - Unique request ID
     * @param {string} message - Original user message
     * @returns {object} Initial progress state
     */
    function create(requestId, message) {
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
            error: null
        };

        try {
            getCache().put({
                key: requestId,
                value: JSON.stringify(state),
                ttl: DEFAULT_TTL
            });

            log.debug('ProgressStore.create', { requestId: requestId });
        } catch (e) {
            log.error('ProgressStore.create failed', { requestId: requestId, error: e.message });
        }

        return state;
    }

    /**
     * Add a step to the progress
     * @param {string} requestId - Request ID
     * @param {object} step - Step object with type, title, status, etc.
     */
    function addStep(requestId, step) {
        try {
            const raw = getCache().get({ key: requestId });
            if (!raw) {
                log.debug('ProgressStore.addStep - request not found', { requestId: requestId });
                return;
            }

            const state = JSON.parse(raw);

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

            getCache().put({
                key: requestId,
                value: JSON.stringify(state),
                ttl: DEFAULT_TTL
            });

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
            const raw = getCache().get({ key: requestId });
            if (!raw) return;

            const state = JSON.parse(raw);
            if (state.steps.length === 0) return;

            const lastStep = state.steps[state.steps.length - 1];
            Object.assign(lastStep, updates);
            state.lastUpdate = Date.now();

            getCache().put({
                key: requestId,
                value: JSON.stringify(state),
                ttl: DEFAULT_TTL
            });
        } catch (e) {
            log.error('ProgressStore.updateLastStep failed', { requestId: requestId, error: e.message });
        }
    }

    /**
     * Mark request as complete with final answer
     * @param {string} requestId - Request ID
     * @param {object} result - Result object with answer, richContent, sessionContext
     */
    function complete(requestId, result) {
        try {
            const raw = getCache().get({ key: requestId });
            if (!raw) {
                log.debug('ProgressStore.complete - request not found', { requestId: requestId });
                return;
            }

            const state = JSON.parse(raw);
            state.status = 'complete';
            state.answer = result.answer || result.text || '';
            state.richContent = result.richContent || null;
            state.sessionContext = result.sessionContext || null;
            state.duration = Date.now() - state.startTime;
            state.lastUpdate = Date.now();
            state.model = result.model || null;
            state.provider = result.provider || null;

            getCache().put({
                key: requestId,
                value: JSON.stringify(state),
                ttl: DEFAULT_TTL
            });

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
     * @param {string} requestId - Request ID
     * @param {string} error - Error message
     */
    function fail(requestId, error) {
        try {
            const raw = getCache().get({ key: requestId });
            if (!raw) return;

            const state = JSON.parse(raw);
            state.status = 'error';
            state.error = error;
            state.duration = Date.now() - state.startTime;
            state.lastUpdate = Date.now();

            getCache().put({
                key: requestId,
                value: JSON.stringify(state),
                ttl: DEFAULT_TTL
            });

            log.error('ProgressStore.fail', { requestId: requestId, error: error });
        } catch (e) {
            log.error('ProgressStore.fail failed', { requestId: requestId, error: e.message });
        }
    }

    /**
     * Get current progress state
     * @param {string} requestId - Request ID
     * @returns {object|null} Progress state or null if not found
     */
    function get(requestId) {
        try {
            const raw = getCache().get({ key: requestId });
            if (!raw) {
                return null;
            }
            return JSON.parse(raw);
        } catch (e) {
            log.error('ProgressStore.get failed', { requestId: requestId, error: e.message });
            return null;
        }
    }

    /**
     * Check if request exists
     * @param {string} requestId - Request ID
     * @returns {boolean}
     */
    function exists(requestId) {
        try {
            const raw = getCache().get({ key: requestId });
            return !!raw;
        } catch (e) {
            return false;
        }
    }

    /**
     * Delete a progress entry (cleanup)
     * @param {string} requestId - Request ID
     */
    function remove(requestId) {
        try {
            getCache().remove({ key: requestId });
        } catch (e) {
            // Ignore remove errors
        }
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
        complete: complete,
        fail: fail,
        get: get,
        exists: exists,
        remove: remove,
        getPollingResponse: getPollingResponse
    };
});
